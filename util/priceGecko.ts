/**
 * priceGecko.ts
 *
 * USD prices from GeckoTerminal's on-chain DEX data, the second market source
 * after DefiLlama (see feeScan.ts priceAssets for the order).
 *
 * WHY
 *
 * DefiLlama prices ~89% of what routers hold by count (99% by value). The rest
 * is a long tail of tokens that trade only on DEXes DefiLlama does not index,
 * plus six whole chains it has no slug for (redbelly, saga, filecoin, gensyn,
 * telos, scroll). GeckoTerminal indexes pools directly on all 34 of our chains
 * and, crucially, reports the pool reserve behind each price -- which is what
 * lets a $0.93 quote from a $1.7M pool be told apart from a $0.0077 quote for
 * the same token from a near-empty one (robinhood USDB, 2026-10-16).
 *
 * TIERS
 *
 * total_reserve_in_usd >= FIRM_MIN_LIQUIDITY_USD  -> firm (counted in totals)
 * below                                            -> thin (shown, not counted)
 *
 * ENDPOINTS
 *
 * With COINGECKO_API_KEY (a Demo key): api.coingecko.com/api/v3/onchain, the
 * same data at 30 req/min. Without: the keyless api.geckoterminal.com, which
 * rate-limits harder. Either way up to 30 addresses per request. The key is
 * sent only as a request header and never logged.
 */
import { toChecksum } from "./address";

export const FIRM_MIN_LIQUIDITY_USD = 10_000;
export const GECKO_BATCH = 30;

/**
 * GeckoTerminal network ids by hardhat network name. Every entry verified on
 * 2026-10-17 by pricing that chain's own curated tokens through the id (e.g.
 * `sei-evm` priced 7/9 where `sei-network` priced 0; `bob-network` not `boba`;
 * `hyperevm` not `hyperliquid`). Not derivable from chain names -- do not guess.
 */
export const GECKO_NETWORK: Record<string, string> = {
  mainnet: "eth",
  op: "optimism",
  rootstock: "rootstock",
  telos: "tlos",
  xdc: "xdc",
  bsc: "bsc",
  gnosis: "xdai",
  unichain: "unichain",
  polygon: "polygon_pos",
  monad: "monad",
  redbelly: "redbelly-network",
  boba: "boba",
  filecoin: "filecoin",
  worldchain: "world-chain",
  hyperevm: "hyperevm",
  sei: "sei-evm",
  pharos: "pharos",
  goat: "goat",
  robinhood: "robinhood",
  mantle: "mantle",
  saga: "saga",
  nibiru: "nibiru",
  base: "base",
  plasma: "plasma",
  zerog: "0g",
  arbitrum: "arbitrum",
  celo: "celo",
  etherlink: "etherlink",
  hemi: "hemi",
  avax: "avax",
  linea: "linea",
  bob: "bob-network",
  scroll: "scroll",
  gensyn: "gensyn",
};

export interface GeckoQuote {
  price: number;
  reserveUsd: number;
}

export interface GeckoResult {
  /** Checksummed address -> quote. */
  prices: Map<string, GeckoQuote>;
  /** Addresses the source was asked about and answered "no price" for. */
  noMarket: Set<string>;
  /** Addresses whose request failed outright (rate limit, outage). */
  failed: Set<string>;
  requests: number;
  warnings: string[];
}

type FetchFn = typeof fetch;

interface GeckoOpts {
  apiKey?: string;
  fetchFn?: FetchFn;
  /** Minimum ms between requests, shared process-wide. */
  minIntervalMs?: number;
  /** ms to wait after a 429 before retrying. */
  backoffMs?: number;
  retries?: number;
  timeoutMs?: number;
}

// One queue for the whole process: fees:scan prices 4 chains concurrently,
// and the rate limit is per key, not per chain.
let queue: Promise<void> = Promise.resolve();
let lastAt = 0;
function throttle(minIntervalMs: number): Promise<void> {
  const next = queue.then(async () => {
    const wait = lastAt + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  });
  queue = next.catch(() => undefined);
  return next;
}

/** Reset the shared throttle. Tests only. */
export function _resetGeckoThrottle(): void {
  queue = Promise.resolve();
  lastAt = 0;
}

/**
 * Current USD prices for `tokens` on `network`. Never throws: an unsupported
 * network or a failed request degrades to "unpriced", reported in warnings.
 */
export async function fetchGeckoPrices(
  network: string,
  tokens: Iterable<string>,
  opts: GeckoOpts = {},
): Promise<GeckoResult> {
  const prices = new Map<string, GeckoQuote>();
  const noMarket = new Set<string>();
  const failed = new Set<string>();
  const warnings: string[] = [];
  let requests = 0;

  const addrs = [...new Set([...tokens].map((t) => toChecksum(t)).filter((a): a is string => !!a))];
  const id = GECKO_NETWORK[network];
  if (addrs.length === 0) return { prices, noMarket, failed, requests, warnings };
  if (!id) {
    for (const a of addrs) failed.add(a);
    warnings.push(`${network}: no GeckoTerminal network id; ${addrs.length} token(s) not looked up there`);
    return { prices, noMarket, failed, requests, warnings };
  }

  const apiKey = opts.apiKey ?? process.env.COINGECKO_API_KEY;
  const fetchFn = opts.fetchFn ?? fetch;
  const base = apiKey
    ? "https://api.coingecko.com/api/v3/onchain"
    : "https://api.geckoterminal.com/api/v2";
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;
  const minInterval = opts.minIntervalMs ?? (apiKey ? 2_100 : 4_000);
  const backoff = opts.backoffMs ?? 61_000;
  const retries = opts.retries ?? 3;

  for (let i = 0; i < addrs.length; i += GECKO_BATCH) {
    const group = addrs.slice(i, i + GECKO_BATCH);
    const url =
      `${base}/simple/networks/${id}/token_price/${group.map((a) => a.toLowerCase()).join(",")}` +
      `?include_total_reserve_in_usd=true`;
    let body: { data?: { attributes?: { token_prices?: Record<string, string | null>; total_reserve_in_usd?: Record<string, string | null> } } } | undefined;
    let lastErr = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      await throttle(minInterval);
      try {
        const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
        requests++;
        if (res.status === 429) {
          lastErr = "HTTP 429 (rate limited)";
          if (attempt < retries) await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          break;
        }
        body = await res.json();
        break;
      } catch (e) {
        lastErr = String((e as Error).message ?? e).slice(0, 80);
      }
    }
    if (!body) {
      for (const a of group) failed.add(a);
      warnings.push(`${network}: GeckoTerminal request failed (${lastErr}); ${group.length} token(s) not priced by it`);
      continue;
    }
    const tp = body.data?.attributes?.token_prices ?? {};
    const tr = body.data?.attributes?.total_reserve_in_usd ?? {};
    for (const a of group) {
      const k = a.toLowerCase();
      const price = Number(tp[k]);
      if (!(tp[k] !== null && tp[k] !== undefined && Number.isFinite(price) && price > 0)) {
        noMarket.add(a);
        continue;
      }
      const reserve = Number(tr[k]);
      prices.set(a, { price, reserveUsd: Number.isFinite(reserve) ? reserve : 0 });
    }
  }
  return { prices, noMarket, failed, requests, warnings };
}
