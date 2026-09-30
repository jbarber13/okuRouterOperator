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
 * It is not a replacement for log discovery, and must never be treated as
 * one. Measured against what `OrderFilled` scanning has actually found, the
 * published list covers 79.7% of it -- 301 of 1,482 known fee assets appear
 * in no list (robinhood alone accounts for 146). A candidate-set probe cannot
 * find a token nobody enumerated; only the log scan can. The two are unioned,
 * and the probe's job is to make the log scan's gaps survivable rather than
 * to make it unnecessary.
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
import { toChecksum } from "./feeScan";
import { readCache } from "./feeAssetCache";
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
    cache: number;
    tokenList: number;
    chainConfig: number;
  };
  /** Non-fatal problems (stale list, fetch failure, …). */
  warnings: string[];
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
  opts: { ttlMs?: number; timeoutMs?: number; offline?: boolean } = {},
): Promise<{ tokens: TokenListEntry[]; warnings: string[]; fromCache: boolean }> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const warnings: string[] = [];
  const cached = readCachedList();

  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return { tokens: cached.tokens, warnings, fromCache: true };
  }
  if (opts.offline) {
    if (cached) return { tokens: cached.tokens, warnings, fromCache: true };
    warnings.push("token list: offline and no cached copy; candidate set is cache + chain-config only");
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
    warnings.push(
      `token list: fetch failed (${msg}) and no cached copy; candidate set is ` +
        `cache + chain-config only, so probe coverage is reduced`,
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
 * The discovery cache is included deliberately even though its tokens are
 * already known: the probe re-reads their balances live, and a token that
 * went to zero and was later re-funded must reappear. Membership of this set
 * is not a claim that the router holds anything.
 */
export function buildTokenUniverse(
  chain: { network: string; chainId: number },
  listByChain: Map<number, Set<string>>,
  cfg?: NetworkConfig,
): TokenUniverse {
  const tokens = new Set<string>();
  const warnings: string[] = [];

  const cached = readCache(chain.network);
  let fromCache = 0;
  for (const t of cached?.tokens ?? []) {
    const a = toChecksum(t);
    if (a && !NOT_A_TOKEN.has(a)) {
      tokens.add(a);
      fromCache++;
    }
  }

  const listed = listByChain.get(chain.chainId) ?? new Set<string>();
  for (const a of listed) tokens.add(a);

  const cc = chainConfigTokens(cfg);
  for (const a of cc) tokens.add(a);

  if (listed.size === 0) {
    warnings.push(
      `${chain.network}: no published token-list entries for chainId ${chain.chainId}; ` +
        `the probe can only re-check already-known and well-known tokens`,
    );
  }

  return {
    tokens,
    sources: { cache: fromCache, tokenList: listed.size, chainConfig: cc.size },
    warnings,
  };
}

/** Exposed for tests. */
export const _internal = { NOT_A_TOKEN, MIN_PLAUSIBLE_TOKENS, CACHE_FILE };
