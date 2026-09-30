/**
 * feeAssetCache.ts
 *
 * Incremental, resumable discovery of which assets have ever been taken as a
 * fee on a given OkuRouter.
 *
 * WHY THIS EXISTS
 *
 * Discovery is the expensive half of a fee scan. The router has no fee
 * accounting, so the only way to learn that (say) some long-tail token once
 * routed through it is to walk `OrderFilled` history. Most public endpoints
 * cap eth_getLogs at 10-100 blocks, so a single chain can need hundreds of
 * requests, and a 34-chain sweep re-walks all of it on every run. For a
 * weekly cadence that is the difference between minutes and hours.
 *
 * Balances are NEVER cached. Only the SET OF TOKEN ADDRESSES ever observed is
 * persisted; every balance is re-read live on every scan. This is the
 * property that makes the cache safe: a stale or truncated cache can only
 * omit a newly-traded asset (which the next run picks up), it can never
 * produce a wrong amount or cause a sweep of the wrong thing.
 *
 * The cache is gitignored. It is a performance aid, not a record. A cold
 * cache degrades to exactly the behaviour of an uncached scan, and repeated
 * runs converge back to full coverage via the backfill pass below.
 *
 * COVERAGE MODEL
 *
 * One contiguous interval `[firstScannedBlock, lastScannedBlock]` is tracked
 * per chain, plus `historyComplete` (true once the interval reaches genesis
 * with no refused windows). Each run spends its request budget on:
 *
 *   1. FORWARD  -- lastScannedBlock+1 .. head. Cheap on a regular cadence.
 *   2. BACKFILL -- leftover budget extends firstScannedBlock downward.
 *
 * so coverage improves monotonically across runs instead of being re-decided
 * by whichever endpoint happened to answer today.
 *
 * Discovered tokens are UNIONED and never evicted. If the interval
 * bookkeeping has to be reset (gap, redeploy, chain reset) the token set
 * survives -- the worst case is re-scanning blocks, never losing an asset.
 */
import * as fs from "fs";
import * as path from "path";
import {
  probeLogRange,
  scanLogWindow,
  toChecksum,
  type LogScanProvider,
  type ScanCoverage,
} from "./feeScan";

/** Cache root. Gitignored: this is derived state, reproducible from chain. */
const CACHE_DIR = path.resolve(__dirname, "..", ".cache", "fee-assets");

/** Default per-chain eth_getLogs request budget for one run. */
export const DEFAULT_MAX_REQUESTS = 400;

/**
 * Cap on how much of that budget the BACKFILL pass may spend.
 *
 * The forward pass is cheap on a regular cadence and is the only one that can
 * see newly-traded assets, so it keeps the full budget. Backfill is the
 * expensive half -- re-walking millions of blocks of history at whatever
 * window the endpoint allows -- and since the Multicall3 balance probe now
 * covers any token that appears in a published list, backfill's remaining job
 * is narrow: find historical assets that are in NO list. That is worth doing,
 * but not worth 400 requests per chain per run.
 *
 * Capped rather than removed because it is still the only source for those
 * assets: measured on the live routers, 4 of 88 held tokens appear in no
 * list at all. Chains converge more slowly, and they do still converge.
 */
export const DEFAULT_MAX_BACKFILL_REQUESTS = 100;

export interface FeeAssetCacheEntry {
  schemaVersion: 1;
  network: string;
  chainId: number;
  /** Router the tokens were discovered against. A change invalidates the entry. */
  router: string;
  /** Lowest block of the contiguous scanned interval. 0 means genesis. */
  firstScannedBlock: number;
  /** Highest block of the contiguous scanned interval; the resume point. */
  lastScannedBlock: number;
  /** True once the interval starts at genesis with no refused windows. */
  historyComplete: boolean;
  /** Log span the endpoint accepted last run, for reporting only. */
  rangeUsed: number;
  /** Every fee asset ever observed. Union-only; entries are never removed. */
  tokens: string[];
  updatedAt: string;
}

export interface DiscoveryResult {
  /** Union of cached and freshly-discovered fee assets. */
  tokens: Set<string>;
  /** Null when the endpoint refused eth_getLogs at every probed range. */
  coverage: ScanCoverage | null;
  /** A valid cache entry was used as the starting point. */
  cacheHit: boolean;
  /** Blocks scanned forward from the previous resume point this run. */
  forwardBlocks: number;
  /** Historical blocks recovered by the backfill pass this run. */
  backfillBlocks: number;
  /** True when the tracked interval now reaches genesis with no holes. */
  historyComplete: boolean;
  /** Tokens known before this run (0 on a cold cache). */
  tokensBefore: number;
  /** Tokens contributed by `extraTokens` that log discovery had never seen. */
  fromProbe: number;
}

export function cachePath(network: string): string {
  return path.join(CACHE_DIR, `${network}.json`);
}

/**
 * Read a cache entry, or undefined if absent, unreadable or structurally
 * invalid. Never throws: a corrupt cache must degrade to a cold scan, not
 * break the sweep.
 */
export function readCache(network: string): FeeAssetCacheEntry | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(network), "utf8"));
    if (raw?.schemaVersion !== 1) return undefined;
    if (typeof raw.router !== "string" || !Array.isArray(raw.tokens)) return undefined;
    if (
      !Number.isInteger(raw.firstScannedBlock) ||
      !Number.isInteger(raw.lastScannedBlock) ||
      raw.firstScannedBlock < 0 ||
      raw.lastScannedBlock < raw.firstScannedBlock
    ) {
      return undefined;
    }
    return raw as FeeAssetCacheEntry;
  } catch {
    return undefined;
  }
}

/** Atomic write, so an interrupted run cannot leave a half-written cache. */
export function writeCache(entry: FeeAssetCacheEntry): void {
  const p = cachePath(entry.network);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, p);
}

export function clearCache(network: string): void {
  try {
    fs.unlinkSync(cachePath(network));
  } catch {
    // Absent is the desired end state either way.
  }
}

/**
 * Whether a cache entry describes the same router we are about to scan.
 *
 * A redeployment makes the stored history another contract's, so its token
 * list must not carry over: it would attach the old router's assets to the
 * new one permanently. Harmless to sweepAll, which skips zero balances, but
 * it corrupts "assets ever seen" for good and pads every future sweep.
 */
export function cacheMatchesRouter(
  entry: FeeAssetCacheEntry | undefined,
  router: string,
): entry is FeeAssetCacheEntry {
  if (!entry) return false;
  try {
    const a = toChecksum(entry.router);
    const b = toChecksum(router);
    return a !== undefined && a === b;
  } catch {
    return false;
  }
}

/**
 * Decide whether a cache entry may be used as a resume point.
 *
 * Rejects on:
 *   - a different router (see above)
 *   - a resume point ahead of the chain head, which means either a chain
 *     reset or -- far more likely -- that the configured endpoint is pointed
 *     at the wrong network. Resuming there would skip all real history.
 */
export function cacheUsable(
  entry: FeeAssetCacheEntry | undefined,
  router: string,
  latest: number,
): entry is FeeAssetCacheEntry {
  if (!cacheMatchesRouter(entry, router)) return false;
  return entry.lastScannedBlock <= latest;
}

function normalizeTokens(tokens: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const t of tokens) {
    // Checksum-tolerant: Rootstock and friends use EIP-1191, so validating
    // the incoming checksum would silently drop perfectly valid addresses
    // and quietly shrink that chain's asset list on every run.
    const addr = toChecksum(t);
    if (addr) set.add(addr);
  }
  return [...set].sort();
}

/**
 * Discover the fee assets for one chain, resuming from cache where possible.
 *
 * `maxRequests` bounds eth_getLogs calls for the whole run (forward pass plus
 * backfill), so a chain with a 100-block cap cannot monopolize a 34-chain
 * sweep.
 */
export async function discoverFeeAssets(
  provider: LogScanProvider,
  chain: { network: string; chainId: number; router: string },
  opts: {
    maxRequests?: number;
    maxBackfillRequests?: number;
    useCache?: boolean;
    write?: boolean;
    /**
     * Addresses discovered by some means other than log scanning -- in
     * practice the Multicall3 balance probe, which observes a non-zero
     * balance directly.
     *
     * These are unioned into the persisted set on the same terms as
     * log-derived ones. The cache's meaning widens slightly, from "assets
     * ever taken as a fee" to "assets ever observed at this router", which is
     * a superset and is what a sweep actually needs. It stays append-only and
     * address-only, so the safety property is unchanged: a wrong entry here
     * can cost a wasted `balanceOf`, never a wrong amount.
     */
    extraTokens?: Iterable<string>;
  } = {},
): Promise<DiscoveryResult> {
  const budget = opts.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const backfillCap = opts.maxBackfillRequests ?? DEFAULT_MAX_BACKFILL_REQUESTS;
  const useCache = opts.useCache !== false;
  const write = opts.write !== false;

  const cached = readCache(chain.network);
  const latest = await provider.getBlockNumber();
  const usable = useCache && cacheUsable(cached, chain.router, latest);

  // Tokens carry forward whenever the entry belongs to THIS router, even when
  // we are not resuming from its block interval.
  //
  // `useCache: false` means "re-walk history", not "forget what we know".
  // That an address once took a fee is an append-only fact, and there is no
  // correctness reason to ever drop one -- whereas dropping them would let a
  // budget-truncated re-scan silently shrink the known asset list, which is
  // exactly the failure the cache exists to prevent. The one case that DOES
  // require forgetting -- a redeployed router -- is handled by the router
  // check, automatically.
  const carried = new Set<string>(
    cacheMatchesRouter(cached, chain.router) ? normalizeTokens(cached.tokens) : [],
  );
  const tokensBefore = carried.size;

  // Union probe results BEFORE the log scan, so they survive every early
  // return below. A chain whose endpoint refuses logs outright (rootstock)
  // has nothing else, and that is exactly where the probe matters most: it
  // found six real balances there, on a chain with no cache file at all.
  let fromProbe = 0;
  for (const t of normalizeTokens(opts.extraTokens ?? [])) {
    if (!carried.has(t)) fromProbe++;
    carried.add(t);
  }

  const range = await probeLogRange(provider, chain.router, latest);
  if (range === 0) {
    // Persist even though no log window was read: the probe may have taught
    // us about assets this run, and dropping them would mean re-learning them
    // every time on precisely the chains that can least afford it.
    if (write && fromProbe > 0) {
      writeCache({
        schemaVersion: 1,
        network: chain.network,
        chainId: chain.chainId,
        router: toChecksum(chain.router) ?? chain.router,
        firstScannedBlock: usable ? cached!.firstScannedBlock : 0,
        lastScannedBlock: usable ? cached!.lastScannedBlock : 0,
        historyComplete: usable ? cached!.historyComplete : false,
        rangeUsed: 0,
        tokens: normalizeTokens(carried),
        updatedAt: new Date().toISOString(),
      });
    }
    // The endpoint refuses logs entirely. Previously-discovered assets are
    // still valid -- they are addresses, not balances -- so hand them back
    // rather than regressing to well-known tokens only.
    return {
      tokens: carried,
      coverage: null,
      cacheHit: usable,
      forwardBlocks: 0,
      backfillBlocks: 0,
      historyComplete: usable ? cached!.historyComplete : false,
      tokensBefore,
      fromProbe,
    };
  }

  // Interval state. `last < first` encodes "no contiguous interval yet", which
  // makes the cold path fall out of the warm path for free: an empty interval
  // has last = -1, so the forward pass starts at block 0.
  let first = usable ? cached!.firstScannedBlock : 0;
  let last = usable ? cached!.lastScannedBlock : -1;
  let complete = usable ? cached!.historyComplete : false;

  let events = 0;
  let refusedWindows = 0;
  let spent = 0;
  let forwardBlocks = 0;
  let backfillBlocks = 0;

  const windowsFor = (from: number, to: number) =>
    to < from ? 0 : Math.ceil((to - from + 1) / range);

  // ---- forward pass: resume point -> head ----
  if (last + 1 <= latest) {
    let from = last + 1;
    let disjoint = false;
    if (windowsFor(from, latest) > budget) {
      // Too far behind to catch up in one run. Prioritize recent blocks --
      // that is where the live balances came from -- and accept that a gap
      // opens below, rather than pretending the gap was covered.
      from = Math.max(0, latest - budget * range + 1);
      disjoint = from > last + 1;
    }
    const fwd = await scanLogWindow(provider, chain.router, from, latest, range);
    spent += windowsFor(from, latest);
    events += fwd.events;
    refusedWindows += fwd.refusedWindows;
    for (const t of fwd.tokens) carried.add(t);
    forwardBlocks = latest - from + 1;

    // scannedThrough, NOT latest. A window refused mid-pass leaves a hole,
    // and recording `latest` as the resume point would skip those blocks on
    // every future run -- any asset first traded inside the hole would become
    // permanently invisible.
    const reached = fwd.scannedThrough;
    if (disjoint) {
      if (reached !== null) {
        first = from;
        last = reached;
        complete = from === 0;
      }
      // reached === null: nothing contiguous was established, so the previous
      // interval (if any) stands. Tokens found are still kept below.
    } else if (reached !== null && reached > last) {
      if (last < first) {
        first = from;
        complete = from === 0;
      }
      last = reached;
    }
  }

  // ---- backfill pass: extend the interval downward with leftover budget ----
  //
  // Capped separately from the forward pass. The forward pass must always be
  // able to reach head -- that is where newly-traded assets are -- whereas
  // backfill is a slow convergence toward genesis that the balance probe has
  // largely made redundant. Spending the whole remaining budget here is what
  // made a scan cost hundreds of requests per chain.
  const remaining = Math.min(budget - spent, backfillCap);
  if (!complete && last >= first && first > 0 && remaining > 0) {
    const to = first - 1;
    const from = Math.max(0, to - remaining * range + 1);
    const back = await scanLogWindow(provider, chain.router, from, to, range);
    events += back.events;
    refusedWindows += back.refusedWindows;
    for (const t of back.tokens) carried.add(t);
    backfillBlocks = to - from + 1;
    // scanLogWindow tracks contiguity upward from `from`, which is the wrong
    // direction for a backfill. Rather than infer a partial lower bound, only
    // extend the interval when the whole window came back clean. Tokens found
    // are kept either way, so a refusal costs a re-scan and nothing else.
    if (back.refusedWindows === 0) {
      first = from;
      if (first === 0) complete = true;
    }
  }

  // An interval was never established (every window refused on a cold cache).
  // Persist the tokens anyway -- they are the valuable part -- but record a
  // resume point of 0 so the next run re-scans from the start rather than
  // trusting a boundary nothing actually verified.
  const established = last >= first;
  const firstOut = established ? first : 0;
  const lastOut = established ? last : 0;
  const completeOut = established ? complete : false;

  const entry: FeeAssetCacheEntry = {
    schemaVersion: 1,
    network: chain.network,
    chainId: chain.chainId,
    router: toChecksum(chain.router) ?? chain.router,
    firstScannedBlock: firstOut,
    lastScannedBlock: lastOut,
    historyComplete: completeOut,
    rangeUsed: range,
    tokens: normalizeTokens(carried),
    updatedAt: new Date().toISOString(),
  };
  if (write) writeCache(entry);

  return {
    tokens: carried,
    coverage: {
      fromBlock: firstOut,
      toBlock: lastOut,
      rangeUsed: range,
      partial: !completeOut,
      events,
      everSeen: carried.size,
      refusedWindows,
      scannedThrough: established ? last : null,
    },
    cacheHit: usable,
    forwardBlocks,
    backfillBlocks,
    historyComplete: completeOut,
    tokensBefore,
    fromProbe,
  };
}
