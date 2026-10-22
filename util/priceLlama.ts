/**
 * priceLlama.ts
 *
 * USD prices from DefiLlama's free coins API: the first market source in
 * feeScan.ts priceAssets (after reviewed aliases, before GeckoTerminal).
 *
 * `confidence` is DefiLlama's 0..1 score. >= MIN_CONFIDENCE (0.9) is a firm
 * price; priceAssets also asks for quotes down to 0.7 and keeps them as THIN
 * (shown, never summed). Stale quotes (> 24h) are rejected outright.
 *
 * fetchLlamaByKeys prices `coingecko:<id>` keys for the reviewed aliases in
 * data/fee-tokens.json.
 */
import { withRetry } from "./rpcRetry";
import { toChecksum } from "./address";

const COINS_CURRENT = "https://coins.llama.fi/prices/current";
const COINS_HISTORICAL = "https://coins.llama.fi/prices/historical";

/**
 * Addresses per request. DefiLlama accepts long URLs, but a failure costs the
 * whole chunk, so this trades a couple of extra round trips for blast radius.
 */
export const DEFAULT_CHUNK = 40;

/** Minimum DefiLlama confidence score to accept a price. */
export const MIN_CONFIDENCE = 0.9;

/** Reject quotes older than this. A stale price is a wrong price. */
export const MAX_PRICE_AGE_SEC = 24 * 60 * 60;

/**
 * DefiLlama chain slugs, keyed by hardhat network name.
 *
 * These are NOT derivable from the chain name, the chainId, or chain-config's
 * `internalName` -- `gnosis` is `xdai`, `worldchain` is `wc`, `hyperevm` is
 * `hyperliquid`, `rootstock` is `rsk`. Every entry here was verified by
 * querying the live API with real token addresses from the discovery cache
 * and confirming a non-zero price came back.
 *
 * Chains DELIBERATELY ABSENT, because probing returned nothing for them:
 *   redbelly, saga, filecoin, gensyn, telos, scroll
 *
 * An absent entry means "no DefiLlama pricing on this chain", which leaves
 * those assets unpriced. That is the correct outcome: guessing a slug would
 * either 404 silently or, far worse, collide with a different chain's
 * namespace and return a confident price for the wrong token.
 */
export const LLAMA_SLUG: Record<string, string> = {
  mainnet: "ethereum",
  op: "optimism",
  rootstock: "rsk",
  xdc: "xdc",
  bsc: "bsc",
  gnosis: "xdai",
  unichain: "unichain",
  polygon: "polygon",
  monad: "monad",
  boba: "boba",
  worldchain: "wc",
  hyperevm: "hyperliquid",
  sei: "sei",
  pharos: "pharos",
  goat: "goat",
  robinhood: "robinhood",
  mantle: "mantle",
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
  bob: "bob",
};

export interface LlamaPrice {
  price: number;
  /**
   * DefiLlama's 0..1 score. Only present on the current-price endpoint; the
   * historical endpoint does not return one, and those quotes are recorded
   * with confidence 1 because there is nothing to gate on.
   */
  confidence: number;
  /** Unix seconds, as reported by DefiLlama. */
  timestamp: number;
  decimals?: number;
  symbol?: string;
  /** True when this came from the historical endpoint. */
  historical?: boolean;
}

export interface LlamaPriceResult {
  /** Checksummed token address -> accepted price. */
  prices: Map<string, LlamaPrice>;
  /** Entries returned but rejected by the confidence or staleness guard. */
  rejected: number;
  /** HTTP requests issued. */
  requests: number;
  warnings: string[];
}

/** Is there a verified DefiLlama slug for this network? */
export function llamaSlug(network: string): string | undefined {
  return LLAMA_SLUG[network];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Fetch current USD prices for `tokens` on `network`.
 *
 * Returns an empty result (not an error) for a network with no verified slug,
 * and for individual chunks that fail: a pricing outage must degrade a report,
 * never abort a sweep.
 */
export async function fetchLlamaPrices(
  network: string,
  tokens: Iterable<string>,
  opts: {
    chunkSize?: number;
    minConfidence?: number;
    maxAgeSec?: number;
    timeoutMs?: number;
    now?: number;
    /**
     * Unix seconds. When set, prices come from the HISTORICAL endpoint as of
     * that moment instead of now.
     *
     * This exists for `fees:account`, which values a sweep at the block it
     * executed in. Using a current price there would silently restate what a
     * past collection was worth every time the report was regenerated -- the
     * record is supposed to be fixed.
     */
    at?: number;
  } = {},
): Promise<LlamaPriceResult> {
  const warnings: string[] = [];
  const prices = new Map<string, LlamaPrice>();
  let rejected = 0;
  let requests = 0;

  const slug = llamaSlug(network);
  if (!slug) {
    return { prices, rejected, requests, warnings };
  }

  const addrs: string[] = [];
  for (const t of tokens) {
    const a = toChecksum(t);
    if (a) addrs.push(a);
  }
  if (addrs.length === 0) return { prices, rejected, requests, warnings };

  const historical = opts.at !== undefined;
  const minConfidence = opts.minConfidence ?? MIN_CONFIDENCE;
  const maxAgeSec = opts.maxAgeSec ?? MAX_PRICE_AGE_SEC;
  // Freshness is judged against the moment we asked about, not the wall clock:
  // for a historical query "24h old" means 24h from that block, not from today.
  const refSec = historical ? opts.at! : Math.floor((opts.now ?? Date.now()) / 1000);

  for (const group of chunk(addrs, opts.chunkSize ?? DEFAULT_CHUNK)) {
    const coins = group.map((a) => `${slug}:${a}`).join(",");
    const url = historical
      ? `${COINS_HISTORICAL}/${opts.at}/${coins}`
      : `${COINS_CURRENT}/${coins}`;
    let body: { coins?: Record<string, Partial<LlamaPrice>> };
    try {
      body = await withRetry(
        async () => {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
          });
          requests++;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.json()) as { coins?: Record<string, Partial<LlamaPrice>> };
        },
        `defillama ${network}`,
        3,
        1_000,
      );
    } catch (e) {
      warnings.push(
        `${network}: DefiLlama request failed (${String((e as Error).message ?? e).slice(0, 80)}); ` +
          `${group.length} token(s) left unpriced by this source`,
      );
      continue;
    }

    for (const [key, val] of Object.entries(body?.coins ?? {})) {
      // Keys come back as "<slug>:<address>" with the address echoed in
      // whatever case we sent, so match on the address half case-insensitively
      // rather than trusting the echo.
      const addr = toChecksum(key.slice(key.indexOf(":") + 1));
      if (!addr) continue;
      const price = Number(val?.price);
      if (!Number.isFinite(price) || price <= 0) continue;

      // The historical endpoint returns no confidence score, so there is
      // nothing to gate on; recorded as 1 rather than silently failing every
      // quote against the current-price threshold.
      const confidence = historical ? 1 : Number(val?.confidence ?? 0);
      const timestamp = Number(val?.timestamp ?? 0);
      if (confidence < minConfidence) {
        rejected++;
        continue;
      }
      // timestamp 0 means DefiLlama did not say when this was observed, which
      // is not evidence of freshness. Historical quotes are compared by
      // absolute distance: a price from AFTER the block is just as wrong as
      // one from long before it.
      if (!timestamp || Math.abs(refSec - timestamp) > maxAgeSec) {
        rejected++;
        continue;
      }
      prices.set(addr, {
        price,
        confidence,
        timestamp,
        decimals: typeof val?.decimals === "number" ? val.decimals : undefined,
        symbol: typeof val?.symbol === "string" ? val.symbol : undefined,
        ...(historical ? { historical: true } : {}),
      });
    }
  }

  if (rejected > 0) {
    warnings.push(
      `${network}: ${rejected} DefiLlama quote(s) rejected as low-confidence or stale`,
    );
  }

  return { prices, rejected, requests, warnings };
}

/** A reviewed price alias: "coingecko:<id>". */
export const ALIAS_RE = /^coingecko:[a-z0-9][a-z0-9-]*$/;

/**
 * Price DefiLlama coin keys directly, e.g. "coingecko:bitcoin". Used for the
 * reviewed aliases in data/fee-tokens.json (`priceAs`, `nativePriceAs`):
 * wrapped-native and pegged tokens whose own address has no market.
 *
 * `at` uses the historical endpoint (accounting). Same confidence/staleness
 * guards as fetchLlamaPrices. Never throws.
 */
export async function fetchLlamaByKeys(
  keys: Iterable<string>,
  opts: { at?: number; minConfidence?: number; maxAgeSec?: number; now?: number; fetchFn?: typeof fetch } = {},
): Promise<{ prices: Map<string, LlamaPrice>; warnings: string[] }> {
  const prices = new Map<string, LlamaPrice>();
  const warnings: string[] = [];
  const list = [...new Set([...keys].filter((k) => ALIAS_RE.test(k)))];
  if (!list.length) return { prices, warnings };
  const historical = opts.at !== undefined;
  const refSec = historical ? opts.at! : Math.floor((opts.now ?? Date.now()) / 1000);
  const url = historical
    ? `${COINS_HISTORICAL}/${opts.at}/${list.join(",")}`
    : `${COINS_CURRENT}/${list.join(",")}`;
  try {
    const res = await (opts.fetchFn ?? fetch)(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { coins?: Record<string, Partial<LlamaPrice>> };
    for (const k of list) {
      const v = body.coins?.[k];
      const price = Number(v?.price);
      const confidence = historical ? 1 : Number(v?.confidence ?? 0);
      const timestamp = Number(v?.timestamp ?? 0);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (confidence < (opts.minConfidence ?? MIN_CONFIDENCE)) continue;
      if (!timestamp || Math.abs(refSec - timestamp) > (opts.maxAgeSec ?? MAX_PRICE_AGE_SEC)) continue;
      prices.set(k, { price, confidence, timestamp, ...(historical ? { historical: true } : {}) });
    }
    for (const k of list) if (!prices.has(k)) warnings.push(`price alias ${k}: no acceptable DefiLlama quote`);
  } catch (e) {
    warnings.push(`price aliases: DefiLlama request failed (${String((e as Error).message ?? e).slice(0, 80)})`);
  }
  return { prices, warnings };
}
