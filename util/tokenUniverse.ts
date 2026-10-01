/**
 * tokenUniverse.ts
 *
 * The set of token addresses worth asking a router about.
 *
 * WHY THIS EXISTS
 *
 * Fee-asset discovery walks `OrderFilled` history with `eth_getLogs`. That is
 * authoritative -- it finds assets nobody has listed anywhere -- but it is
 * also the expensive and fragile half of a scan: most endpoints cap the log
 * range, the cap is undiscoverable except by being rejected, and one chain
 * (rootstock) serves no logs at all. On 2026-09-29 that cost a whole sweep:
 * arbitrum discovered zero assets and left 33 tokens behind.
 *
 * There is a much cheaper question available. The router can only ever hold a
 * fee in a token somebody actually swapped through Oku, and Oku publishes the
 * list of tokens it will route. Asking `balanceOf(router)` for every token on
 * that list costs a handful of `eth_call`s at head -- no log range, no archive
 * node, no endpoint that refuses. Measured across all 33 cached chains the
 * whole probe is 87 calls, against a getLogs budget of up to 400 PER CHAIN.
 *
 * WHAT THIS IS NOT
 *
 * A complete picture. A candidate set cannot contain a token nobody ever
 * enumerated, and the router accepts ANY ERC20 as `tokenIn` -- there is no
 * on-chain token allowlist, only an allowlist of aggregator targets. Measured
 * on base: 63 of 300 distinct `tokenIn` addresses (21%) appear in no published
 * list.
 *
 * That gap is why data/known-fee-assets.json exists. It is a one-time export
 * of every address `OrderFilled` log scanning had discovered before indexing
 * was removed -- 1,496 addresses, 301 of them unlisted -- carried forward as a
 * static seed so the pivot to list-based discovery cost nothing that was
 * already known. It is not a cache and nothing regenerates it.
 *
 * What remains unsolved: a token first traded AFTER that export, by direct
 * contract call, and never added to any list, is invisible here.
 * `scripts/dryRunDiscovery.ts` measures that drift against real logs.
 *
 * SAFETY PROPERTY
 *
 * Everything here is a set of ADDRESSES. Balances are always read live from
 * chain. A stale, truncated or empty universe can therefore only cause an
 * asset to be missed on this run -- it can never produce a wrong amount, and
 * it can never cause the wrong thing to be swept.
 */
import * as fs from "fs";
import * as path from "path";
import { toChecksum } from "./address";
import type { NetworkConfig } from "./deploymentConfig";

/** Oku's published routing token list: exactly the tokens that can become fees. */
export const OKU_TOKENLIST_URL = "https://cdn.oku.trade/tokenlist.json";

/** Cache root. Gitignored derived state, same rationale as .cache/fee-assets. */
const CACHE_DIR = path.resolve(__dirname, "..", ".cache", "tokenlist");

const CACHE_FILE = path.join(CACHE_DIR, "oku.json");

/** How long a cached copy is served before we try the network again. */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Guard against a truncated or hijacked response replacing a good cache. */
const MIN_PLAUSIBLE_TOKENS = 1_000;

/**
 * Addresses that are never real ERC20s to probe.
 *
 * The native sentinel in particular: `balanceOf` on a non-contract returns
 * empty, which the probe would discard anyway, but including it invites a
 * caller to confuse it with the synthetic native asset entry that
 * `scanChainFees` adds separately.
 */
const NOT_A_TOKEN = new Set([
  "0x0000000000000000000000000000000000000000",
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
]);

export interface TokenListEntry {
  chainId: number;
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
}

export interface TokenUniverse {
  /** Candidate addresses, checksummed, safe to probe. */
  tokens: Set<string>;
  /** Where each source contributed, for reporting. Counts, not sets. */
  sources: {
    seed: number;
    tokenList: number;
    chainConfig: number;
  };
  /** Non-fatal problems (stale list, fetch failure, …). */
  warnings: string[];
}

/** Committed one-time export of assets discovered before indexing was removed. */
interface KnownFeeAssets {
  kind: string;
  schemaVersion: number;
  tokensByChainId: Record<string, string[]>;
}

let seedCache: Map<number, Set<string>> | undefined;

/**
 * Load the committed seed of previously-observed fee assets.
 *
 * Read once and memoized. A missing or malformed file is NOT fatal -- it
 * degrades the candidate set to the published list, which is the same
 * situation as a chain the seed never covered.
 */
export function loadKnownFeeAssets(): Map<number, Set<string>> {
  if (seedCache) return seedCache;
  const out = new Map<number, Set<string>>();
  try {
    const file = path.resolve(__dirname, "..", "data", "known-fee-assets.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as KnownFeeAssets;
    for (const [chainId, tokens] of Object.entries(raw?.tokensByChainId ?? {})) {
      const id = Number(chainId);
      if (!Number.isInteger(id) || !Array.isArray(tokens)) continue;
      const set = new Set<string>();
      for (const t of tokens) {
        const a = toChecksum(t);
        if (a && !NOT_A_TOKEN.has(a)) set.add(a);
      }
      if (set.size) out.set(id, set);
    }
  } catch {
    // Absent seed: the published list still stands on its own.
  }
  seedCache = out;
  return out;
}

interface CachedList {
  fetchedAt: number;
  tokens: TokenListEntry[];
}

function readCachedList(): CachedList | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (!Array.isArray(raw?.tokens) || typeof raw.fetchedAt !== "number") return undefined;
    if (raw.tokens.length < MIN_PLAUSIBLE_TOKENS) return undefined;
    return raw as CachedList;
  } catch {
    return undefined;
  }
}

function writeCachedList(list: CachedList): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list), "utf8");
  fs.renameSync(tmp, CACHE_FILE);
}

/**
 * Fetch the Oku token list, preferring a fresh copy but never failing closed.
 *
 * Precedence:
 *   1. a cached copy younger than `ttlMs`
 *   2. a fresh fetch
 *   3. ANY cached copy, however old
 *   4. empty, with a warning
 *
 * Step 3 is the important one. This list feeds discovery, so a CDN outage
 * must degrade to "yesterday's candidate set" rather than "no candidates",
 * which would silently shrink what the probe can see on every chain at once.
 * An address that was worth probing yesterday is still worth probing today --
 * the list only grows, and balances are read live regardless.
 */
export async function loadOkuTokenList(
  opts: {
    ttlMs?: number;
    timeoutMs?: number;
    offline?: boolean;
    /**
     * Throw rather than return an empty list.
     *
     * Since indexing was removed this list is the only DYNAMIC discovery
     * source there is. An empty one does not produce an error anywhere
     * downstream -- it produces a scan that finds almost nothing, on every
     * chain at once, which reads exactly like a set of empty routers. Any
     * path that decides what to sweep must set this.
     */
    strict?: boolean;
  } = {},
): Promise<{ tokens: TokenListEntry[]; warnings: string[]; fromCache: boolean }> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const warnings: string[] = [];
  const cached = readCachedList();

  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return { tokens: cached.tokens, warnings, fromCache: true };
  }
  if (opts.offline) {
    if (cached) return { tokens: cached.tokens, warnings, fromCache: true };
    if (opts.strict) {
      throw new Error(
        "token list: --offline with no cached copy. Discovery would run against the seed " +
          "and chain-config alone, which is not a basis for deciding what to sweep.",
      );
    }
    warnings.push("token list: offline and no cached copy; candidate set is seed + chain-config only");
    return { tokens: [], warnings, fromCache: false };
  }

  try {
    const res = await fetch(OKU_TOKENLIST_URL, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { tokens?: TokenListEntry[] };
    const tokens = Array.isArray(body?.tokens) ? body.tokens : [];
    // A short list is far more likely to be a truncated/proxied response than
    // a genuine shrink, and overwriting a good cache with it would quietly
    // degrade every chain at once.
    if (tokens.length < MIN_PLAUSIBLE_TOKENS) {
      throw new Error(`implausibly short list (${tokens.length} entries)`);
    }
    writeCachedList({ fetchedAt: Date.now(), tokens });
    return { tokens, warnings, fromCache: false };
  } catch (e) {
    const msg = String((e as { message?: string }).message ?? e);
    if (cached) {
      const ageH = ((Date.now() - cached.fetchedAt) / 3_600_000).toFixed(1);
      warnings.push(`token list: fetch failed (${msg}); using cached copy ${ageH}h old`);
      return { tokens: cached.tokens, warnings, fromCache: true };
    }
    if (opts.strict) {
      throw new Error(
        `token list: fetch failed (${msg}) and no cached copy is available. Since log ` +
          `indexing was removed this list is the only dynamic discovery source, so a scan ` +
          `would silently find almost nothing on every chain. Refusing to continue.`,
      );
    }
    warnings.push(
      `token list: fetch failed (${msg}) and no cached copy; candidate set is ` +
        `seed + chain-config only, so probe coverage is badly reduced`,
    );
    return { tokens: [], warnings, fromCache: false };
  }
}

/** Index a flat token list by chainId, checksummed and de-duplicated. */
export function indexByChain(tokens: TokenListEntry[]): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const t of tokens) {
    const addr = toChecksum(t?.address);
    if (!addr || NOT_A_TOKEN.has(addr)) continue;
    const chainId = Number(t.chainId);
    if (!Number.isInteger(chainId)) continue;
    let set = out.get(chainId);
    if (!set) {
      set = new Set<string>();
      out.set(chainId, set);
    }
    set.add(addr);
  }
  return out;
}

/**
 * Well-known tokens from chain-config for one chain.
 *
 * Small, but it is the only source that survives both an empty token list and
 * a cold discovery cache, and it covers the assets that hold the value.
 */
export function chainConfigTokens(cfg: NetworkConfig | undefined): Set<string> {
  const out = new Set<string>();
  if (!cfg) return out;
  const chain = cfg.chain as unknown as {
    token?: Record<string, string | undefined>;
    tokenList?: ReadonlyArray<{ address?: string }>;
    stables?: ReadonlyArray<string>;
  };
  const add = (v: string | undefined) => {
    const a = toChecksum(v);
    if (a && !NOT_A_TOKEN.has(a)) out.add(a);
  };
  add(cfg.wethAddress);
  add(cfg.usdcAddress);
  for (const v of Object.values(chain.token ?? {})) add(v);
  for (const t of chain.tokenList ?? []) add(t?.address);
  for (const s of chain.stables ?? []) add(s);
  return out;
}

/**
 * Build the candidate set for one chain.
 *
 * The seed is included even though those addresses are already "known": the
 * probe reads balances live, so a token that went to zero and was later
 * re-funded must reappear. Membership of this set is never a claim that the
 * router holds anything.
 */
export function buildTokenUniverse(
  chain: { network: string; chainId: number },
  listByChain: Map<number, Set<string>>,
  cfg?: NetworkConfig,
): TokenUniverse {
  const tokens = new Set<string>();
  const warnings: string[] = [];

  const seeded = loadKnownFeeAssets().get(chain.chainId) ?? new Set<string>();
  for (const a of seeded) tokens.add(a);

  const listed = listByChain.get(chain.chainId) ?? new Set<string>();
  for (const a of listed) tokens.add(a);

  const cc = chainConfigTokens(cfg);
  for (const a of cc) tokens.add(a);

  if (listed.size === 0) {
    warnings.push(
      `${chain.network}: no published token-list entries for chainId ${chain.chainId}; ` +
        `the probe can only check seeded and well-known tokens`,
    );
  }

  return {
    tokens,
    sources: { seed: seeded.size, tokenList: listed.size, chainConfig: cc.size },
    warnings,
  };
}

/** Exposed for tests. */
export const _internal = { NOT_A_TOKEN, MIN_PLAUSIBLE_TOKENS, CACHE_FILE };
