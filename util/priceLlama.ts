/**
 * priceLlama.ts
 *
 * USD prices from DefiLlama's free coins API, used ONLY as a fallback for
 * assets the on-chain Uniswap V3 path could not value.
 *
 * WHY A SECOND SOURCE AT ALL
 *
 * The V3 path is the better source where it works: it needs no key, cannot
 * disagree with the chain, and reports pool DEPTH, which is what makes a
 * price actionable rather than merely printable. But it can only price what
 * has a V3 pool, and most of what a router accrues does not. Measured on the
 * 2026-09-30 scan: 173 of 335 assets (51.6%) had no price at all, and eleven
 * chains reported exactly "$0.00" while holding assets. DefiLlama prices 137
 * of the 166 unpriced ERC20s (82.5%).
 *
 * WHAT IT IS NOT ALLOWED TO DO
 *
 * It must not inflate `realizableUsd`. A Llama price says what a token is
 * worth somewhere; it says nothing about whether this chain has the liquidity
 * to exit into. Depth remains a purely on-chain measurement, so an asset
 * priced only from here reports a notional and NO realizable figure. That
 * keeps `--min-usd` honest and preserves the module's founding rule that a
 * fabricated number is worse than an absent one.
 *
 * The other guard is `confidence`. DefiLlama returns a 0..1 score per coin;
 * low-confidence entries are frequently stale or derived from a single thin
 * venue, which is the same failure the V3 dust-pool floor exists to reject.
 */
import { withRetry } from "./rpcRetry";
import { toChecksum } from "./feeScan";

const COINS_API = "https://coins.llama.fi/prices/current";

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
  confidence: number;
  /** Unix seconds, as reported by DefiLlama. */
  timestamp: number;
  decimals?: number;
  symbol?: string;
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

  const minConfidence = opts.minConfidence ?? MIN_CONFIDENCE;
  const maxAgeSec = opts.maxAgeSec ?? MAX_PRICE_AGE_SEC;
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);

  for (const group of chunk(addrs, opts.chunkSize ?? DEFAULT_CHUNK)) {
    const url = `${COINS_API}/${group.map((a) => `${slug}:${a}`).join(",")}`;
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

      const confidence = Number(val?.confidence ?? 0);
      const timestamp = Number(val?.timestamp ?? 0);
      if (confidence < minConfidence) {
        rejected++;
        continue;
      }
      // timestamp 0 means DefiLlama did not say when this was observed, which
      // is not evidence of freshness.
      if (!timestamp || nowSec - timestamp > maxAgeSec) {
        rejected++;
        continue;
      }
      prices.set(addr, {
        price,
        confidence,
        timestamp,
        decimals: typeof val?.decimals === "number" ? val.decimals : undefined,
        symbol: typeof val?.symbol === "string" ? val.symbol : undefined,
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
