/**
 * Pricing.ts
 *
 * Offline tests for the layered price chain in util/feeScan.ts priceAssets:
 * alias -> DefiLlama -> GeckoTerminal, and the firm/thin/unpriced tiers.
 *
 * The property that matters: a thin price is SHOWN but can never reach a
 * total or --min-usd, and an unpriced asset always says why.
 */
import { expect } from "chai";
import { getAddress } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { priceAssets, totalUsd, type FeeAsset } from "../../util/feeScan";
import { fetchGeckoPrices, _resetGeckoThrottle, type GeckoResult } from "../../util/priceGecko";
import { emptyFeeTokens } from "../../util/feeTokens";
import type { NetworkConfig } from "../../util/deploymentConfig";

const T = (n: number) => getAddress("0x" + n.toString(16).padStart(40, "0"));
const [A, B, C, D, E] = [1, 2, 3, 4, 5].map(T);

const cfg = { networkName: "base", chainId: 8453, nativeSymbol: "ETH", chain: {} } as unknown as NetworkConfig;
const provider = {} as JsonRpcProvider;
const asset = (token: string): FeeAsset => ({ token, symbol: "X", decimals: 18, balance: 10n ** 18n });

type LlamaCoins = Record<string, { price: number; confidence?: number; timestamp?: number }>;
let realFetch: typeof fetch;
let llamaCalls: string[];
function stubLlama(coins: LlamaCoins) {
  llamaCalls = [];
  globalThis.fetch = (async (url: string) => {
    llamaCalls.push(String(url));
    const now = Math.floor(Date.now() / 1000);
    const out: LlamaCoins = {};
    for (const [k, v] of Object.entries(coins)) {
      if (String(url).includes(k)) out[k] = { confidence: 0.99, timestamp: now, ...v };
    }
    return new Response(JSON.stringify({ coins: out }), { status: 200 });
  }) as typeof fetch;
}
function gecko(map: Record<string, { price: number; reserveUsd: number } | "none" | "fail">) {
  return (async (_n: string, tokens: Iterable<string>): Promise<GeckoResult> => {
    const r: GeckoResult = { prices: new Map(), noMarket: new Set(), failed: new Set(), requests: 1, warnings: [] };
    for (const t of tokens) {
      const v = map[t];
      if (v === "fail") r.failed.add(t);
      else if (!v || v === "none") r.noMarket.add(t);
      else r.prices.set(t, v);
    }
    return r;
  }) as typeof fetchGeckoPrices;
}

describe("pricing: layered sources and tiers", () => {
  before(() => (realFetch = globalThis.fetch));
  after(() => (globalThis.fetch = realFetch));

  it("DefiLlama >= 0.9 is firm and GeckoTerminal is not consulted for it", async () => {
    stubLlama({ [`base:${A}`]: { price: 2 } });
    let asked: string[] = [];
    const g = (async (n: string, t: Iterable<string>) => {
      asked = [...t];
      return gecko({})(n, []);
    }) as typeof fetchGeckoPrices;
    const { priced } = await priceAssets(provider, cfg, [asset(A)], { feeTokens: null, fetchGecko: g });
    expect(priced[0].priceTier).to.equal("firm");
    expect(priced[0].usdValue).to.equal(2);
    expect(asked).to.deep.equal([]);
  });

  it("GeckoTerminal: >= $10k reserve firm, below thin; thin is excluded from totals", async () => {
    stubLlama({});
    const { priced } = await priceAssets(provider, cfg, [asset(A), asset(B)], {
      feeTokens: null,
      fetchGecko: gecko({ [A]: { price: 3, reserveUsd: 10_000 }, [B]: { price: 5, reserveUsd: 9_999 } }),
    });
    expect(priced[0].priceTier).to.equal("firm");
    expect(priced[0].usdValue).to.equal(3);
    expect(priced[0].liquidityUsd).to.equal(10_000);
    expect(priced[1].priceTier).to.equal("thin");
    expect(priced[1].usdValue).to.equal(undefined);
    expect(priced[1].usdValueThin).to.equal(5);
    const t = totalUsd(priced);
    expect(t).to.deep.equal({ notional: 3, unpriced: 0, thinUsd: 5, thinCount: 1 });
  });

  it("low-confidence DefiLlama is thin, upgraded by a firm DEX price, preferred over a thin one", async () => {
    stubLlama({ [`base:${A}`]: { price: 1, confidence: 0.8 }, [`base:${B}`]: { price: 1, confidence: 0.8 } });
    const { priced } = await priceAssets(provider, cfg, [asset(A), asset(B)], {
      feeTokens: null,
      fetchGecko: gecko({ [A]: { price: 1.1, reserveUsd: 500_000 }, [B]: { price: 9, reserveUsd: 100 } }),
    });
    expect(priced[0].priceTier).to.equal("firm");
    expect(priced[0].priceSource).to.match(/^gecko:/);
    expect(priced[1].priceTier).to.equal("thin");
    expect(priced[1].usdValueThin).to.equal(1);
    expect(priced[1].priceSource).to.equal("llama:0.80");
  });

  it("a reviewed alias takes precedence over every market source", async () => {
    stubLlama({ "coingecko:bitcoin": { price: 80_000 }, [`base:${A}`]: { price: 1 } });
    const ft = emptyFeeTokens();
    ft.chains["8453"] = {
      network: "base",
      mode: "auto",
      tokens: [{ address: A, symbol: "BTCX", decimals: 18, source: "t", addedAt: "t", priceAs: "coingecko:bitcoin" }],
    };
    const { priced } = await priceAssets(provider, cfg, [asset(A)], { feeTokens: ft, fetchGecko: gecko({}) });
    expect(priced[0].usdValue).to.equal(80_000);
    expect(priced[0].priceSource).to.equal("alias:coingecko:bitcoin");
  });

  it("native is priced through nativePriceAs without needing a wrapped token", async () => {
    stubLlama({ "coingecko:celo": { price: 0.1 } });
    const ft = emptyFeeTokens();
    ft.chains["8453"] = { network: "base", mode: "auto", nativePriceAs: "coingecko:celo", tokens: [] };
    const { priced, nativeUsd } = await priceAssets(provider, cfg, [{ ...asset("native"), token: "native" }], {
      feeTokens: ft,
      fetchGecko: gecko({}),
    });
    expect(nativeUsd).to.equal(0.1);
    expect(priced[0].priceTier).to.equal("firm");
  });

  it("unpriced assets say why: no-market vs source-error", async () => {
    stubLlama({});
    const { priced } = await priceAssets(provider, cfg, [asset(C), asset(D)], {
      feeTokens: null,
      fetchGecko: gecko({ [C]: "none", [D]: "fail" }),
    });
    expect(priced[0].priceSource).to.equal("unpriced:no-market");
    expect(priced[1].priceSource).to.equal("unpriced:source-error");
    expect(totalUsd(priced).unpriced).to.equal(2);
  });

  it("historical pricing does not use current DEX prices for old records", async () => {
    stubLlama({});
    let called = false;
    const g = (async (n: string, t: Iterable<string>) => {
      called = true;
      return gecko({ [E]: { price: 1, reserveUsd: 1e6 } })(n, t);
    }) as typeof fetchGeckoPrices;
    const old = Math.floor(Date.now() / 1000) - 86_400;
    const r1 = await priceAssets(provider, cfg, [asset(E)], { feeTokens: null, fetchGecko: g, at: old });
    expect(called).to.equal(false);
    expect(r1.priced[0].priceTier).to.equal(undefined);
    const recent = Math.floor(Date.now() / 1000) - 60;
    const r2 = await priceAssets(provider, cfg, [asset(E)], { feeTokens: null, fetchGecko: g, at: recent });
    expect(r2.priced[0].priceSource).to.match(/^gecko-current:/);
  });
});

describe("pricing: GeckoTerminal client", () => {
  beforeEach(() => _resetGeckoThrottle());

  function res(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status });
  }

  it("batches 30 addresses per request, reads reserves, splits priced / no-market", async () => {
    const urls: string[] = [];
    const tokens = Array.from({ length: 31 }, (_, i) => T(100 + i));
    const fetchFn = (async (url: string) => {
      urls.push(url);
      const addrs = url.split("/token_price/")[1].split("?")[0].split(",");
      const tp: Record<string, string | null> = {};
      const tr: Record<string, string> = {};
      addrs.forEach((a, i) => {
        tp[a] = i === 0 ? null : "1.5";
        tr[a] = "20000";
      });
      return res(200, { data: { attributes: { token_prices: tp, total_reserve_in_usd: tr } } });
    }) as typeof fetch;
    const r = await fetchGeckoPrices("base", tokens, { apiKey: "k", fetchFn, minIntervalMs: 0 });
    expect(urls.length).to.equal(2);
    expect(urls[0]).to.match(/^https:\/\/api\.coingecko\.com\/api\/v3\/onchain\/simple\/networks\/base\/token_price\//);
    expect(r.prices.size).to.equal(29);
    expect(r.noMarket.size).to.equal(2);
    expect([...r.prices.values()][0]).to.deep.equal({ price: 1.5, reserveUsd: 20000 });
  });

  it("uses the keyless endpoint without a key and never sends a key header then", async () => {
    let headers: Record<string, string> = {};
    const fetchFn = (async (url: string, init: { headers: Record<string, string> }) => {
      headers = init.headers;
      expect(url).to.match(/^https:\/\/api\.geckoterminal\.com\/api\/v2\//);
      return res(200, { data: { attributes: { token_prices: {} } } });
    }) as unknown as typeof fetch;
    await fetchGeckoPrices("base", [A], { apiKey: "", fetchFn, minIntervalMs: 0 });
    expect(Object.keys(headers)).to.not.include("x-cg-demo-api-key");
  });

  it("backs off on 429 and retries", async () => {
    let n = 0;
    const fetchFn = (async () => {
      n++;
      return n === 1
        ? res(429, {})
        : res(200, { data: { attributes: { token_prices: { [A.toLowerCase()]: "2" }, total_reserve_in_usd: {} } } });
    }) as typeof fetch;
    const r = await fetchGeckoPrices("base", [A], { apiKey: "k", fetchFn, minIntervalMs: 0, backoffMs: 1 });
    expect(n).to.equal(2);
    expect(r.prices.get(A)?.price).to.equal(2);
  });

  it("gives up after retries and marks the batch failed, not no-market", async () => {
    const fetchFn = (async () => res(429, {})) as typeof fetch;
    const r = await fetchGeckoPrices("base", [A], { apiKey: "k", fetchFn, minIntervalMs: 0, backoffMs: 1, retries: 2 });
    expect(r.failed.has(A)).to.equal(true);
    expect(r.noMarket.size).to.equal(0);
  });

  it("reports an unmapped network instead of guessing an id", async () => {
    const r = await fetchGeckoPrices("notachain", [A], { apiKey: "k", fetchFn: (async () => { throw new Error("must not fetch"); }) as typeof fetch });
    expect(r.failed.has(A)).to.equal(true);
    expect(r.warnings.join()).to.match(/no GeckoTerminal network id/);
  });
});
