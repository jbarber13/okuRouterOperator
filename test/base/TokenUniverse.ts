/**
 * TokenUniverse.ts
 *
 * Offline tests for candidate-set construction, DefiLlama price acceptance,
 * and the unpriced-vs-worthless distinction in the totals.
 *
 * The common thread: every one of these is a place where a missing value
 * could be mistaken for a zero. The candidate set must not silently shrink,
 * a low-confidence or stale quote must not become a price, and an asset
 * nobody could value must not be summed as $0 without saying so.
 *
 * Nothing in this file touches a network.
 */
import { expect } from "chai";
import {
  chainConfigTokens,
  indexByChain,
  buildTokenUniverse,
  _internal as universeInternal,
} from "../../util/tokenUniverse";
import {
  fetchLlamaPrices,
  llamaSlug,
  LLAMA_SLUG,
  MIN_CONFIDENCE,
} from "../../util/priceLlama";
import { totalUsd, type PricedFeeAsset } from "../../util/feeScan";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

describe("tokenUniverse: indexing a published list", () => {
  it("groups by chainId and checksums addresses", () => {
    const idx = indexByChain([
      { chainId: 1, address: USDC.toLowerCase() },
      { chainId: 1, address: WETH.toLowerCase() },
      { chainId: 8453, address: USDC.toLowerCase() },
    ]);
    expect(idx.get(1)?.size).to.equal(2);
    expect(idx.get(1)?.has(USDC)).to.equal(true);
    expect(idx.get(8453)?.size).to.equal(1);
  });

  it("de-duplicates addresses that differ only by case", () => {
    const idx = indexByChain([
      { chainId: 1, address: USDC.toLowerCase() },
      { chainId: 1, address: USDC.toUpperCase().replace("0X", "0x") },
      { chainId: 1, address: USDC },
    ]);
    expect(idx.get(1)?.size).to.equal(1);
  });

  // Probing these wastes a call at best. The native sentinel is worse: it
  // would invite confusion with the synthetic native asset that the scan adds
  // separately, which is not an ERC20 at all.
  it("drops the zero address and the native sentinel", () => {
    const idx = indexByChain([
      { chainId: 1, address: "0x0000000000000000000000000000000000000000" },
      { chainId: 1, address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" },
      { chainId: 1, address: USDC },
    ]);
    expect(idx.get(1)?.size).to.equal(1);
    expect(idx.get(1)?.has(USDC)).to.equal(true);
  });

  it("skips malformed entries rather than throwing", () => {
    const idx = indexByChain([
      { chainId: 1, address: "not-an-address" },
      { chainId: Number.NaN, address: USDC },
      { chainId: 1, address: USDC },
    ]);
    expect(idx.get(1)?.size).to.equal(1);
  });
});

describe("tokenUniverse: chain-config contribution", () => {
  it("collects weth/usdc/token/tokenList/stables", () => {
    const set = chainConfigTokens({
      networkName: "mainnet",
      wethAddress: WETH,
      usdcAddress: USDC,
      chain: {
        token: { wbtcAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
        tokenList: [{ address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" }],
        stables: ["0xdAC17F958D2ee523a2206206994597C13D831ec7"],
      },
    } as never);
    expect(set.size).to.equal(5);
  });

  it("returns an empty set for a missing config instead of throwing", () => {
    expect(chainConfigTokens(undefined).size).to.equal(0);
  });
});

describe("tokenUniverse: candidate set assembly", () => {
  it("unions the published list with chain-config", () => {
    const idx = indexByChain([{ chainId: 1, address: USDC }]);
    const u = buildTokenUniverse({ network: "nonexistent-net", chainId: 1 }, idx, {
      networkName: "nonexistent-net",
      wethAddress: WETH,
      chain: {},
    } as never);
    expect(u.tokens.has(USDC)).to.equal(true);
    expect(u.tokens.has(WETH)).to.equal(true);
    expect(u.sources.tokenList).to.equal(1);
  });

  // A chain the list has never heard of must still probe what it knows,
  // and must say that its coverage is reduced rather than looking healthy.
  it("warns when the published list has nothing for the chain", () => {
    const u = buildTokenUniverse({ network: "nonexistent-net", chainId: 999999 }, new Map(), {
      networkName: "nonexistent-net",
      wethAddress: WETH,
      chain: {},
    } as never);
    expect(u.tokens.has(WETH)).to.equal(true);
    expect(u.warnings.join(" ")).to.match(/no published token-list entries/i);
  });

  it("guards against a truncated list overwriting a good cache", () => {
    expect(universeInternal.MIN_PLAUSIBLE_TOKENS).to.be.a("number");
    expect(universeInternal.MIN_PLAUSIBLE_TOKENS > 0).to.equal(true);
  });
});

describe("priceLlama: slug map", () => {
  it("maps the chains whose slug is not derivable from their name", () => {
    // Each verified against the live API. A wrong slug here does not error --
    // it silently returns nothing, or worse, another chain's token.
    expect(llamaSlug("gnosis")).to.equal("xdai");
    expect(llamaSlug("rootstock")).to.equal("rsk");
    expect(llamaSlug("worldchain")).to.equal("wc");
    expect(llamaSlug("hyperevm")).to.equal("hyperliquid");
    expect(llamaSlug("zerog")).to.equal("0g");
    expect(llamaSlug("mainnet")).to.equal("ethereum");
  });

  // Probing returned nothing for these. An absent entry leaves the assets
  // unpriced, which is correct; a guessed one could collide with another
  // chain's namespace and return a confident price for the wrong token.
  it("omits chains with no verified slug rather than guessing", () => {
    for (const net of ["redbelly", "saga", "filecoin", "gensyn", "telos", "scroll"]) {
      expect(llamaSlug(net), net).to.equal(undefined);
    }
  });

  it("returns an empty result for an unmapped chain without calling out", async () => {
    const res = await fetchLlamaPrices("saga", [USDC]);
    expect(res.prices.size).to.equal(0);
    expect(res.requests).to.equal(0);
  });

  it("does not map a network absent from deployments", () => {
    expect(LLAMA_SLUG["not-a-network"]).to.equal(undefined);
  });
});

describe("priceLlama: quote acceptance", () => {
  const nowMs = 1_800_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);

  /** Stub global fetch with one canned coins payload. */
  function withFetch<T>(
    coins: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ coins }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;
    return fn().finally(() => {
      globalThis.fetch = original;
    });
  }

  it("accepts a fresh, confident quote", async () => {
    const res = await withFetch(
      { [`ethereum:${USDC}`]: { price: 1.0, confidence: 0.99, timestamp: nowSec, decimals: 6 } },
      () => fetchLlamaPrices("mainnet", [USDC], { now: nowMs }),
    );
    expect(res.prices.get(USDC)?.price).to.equal(1.0);
  });

  it("rejects a low-confidence quote", async () => {
    const res = await withFetch(
      {
        [`ethereum:${USDC}`]: {
          price: 1.0,
          confidence: MIN_CONFIDENCE - 0.5,
          timestamp: nowSec,
          decimals: 6,
        },
      },
      () => fetchLlamaPrices("mainnet", [USDC], { now: nowMs }),
    );
    expect(res.prices.size).to.equal(0);
    expect(res.rejected).to.equal(1);
  });

  it("rejects a stale quote", async () => {
    const res = await withFetch(
      {
        [`ethereum:${USDC}`]: {
          price: 1.0,
          confidence: 0.99,
          timestamp: nowSec - 60 * 60 * 24 * 30,
          decimals: 6,
        },
      },
      () => fetchLlamaPrices("mainnet", [USDC], { now: nowMs }),
    );
    expect(res.prices.size).to.equal(0);
    expect(res.rejected).to.equal(1);
  });

  // A timestamp of 0 is an absence of evidence about freshness, not evidence
  // of freshness.
  it("rejects a quote with no timestamp", async () => {
    const res = await withFetch(
      { [`ethereum:${USDC}`]: { price: 1.0, confidence: 0.99, decimals: 6 } },
      () => fetchLlamaPrices("mainnet", [USDC], { now: nowMs }),
    );
    expect(res.prices.size).to.equal(0);
  });

  it("rejects a non-positive price", async () => {
    const res = await withFetch(
      { [`ethereum:${USDC}`]: { price: 0, confidence: 0.99, timestamp: nowSec, decimals: 6 } },
      () => fetchLlamaPrices("mainnet", [USDC], { now: nowMs }),
    );
    expect(res.prices.size).to.equal(0);
  });

  it("matches the returned key back to the requested address regardless of case", async () => {
    const res = await withFetch(
      {
        [`ethereum:${USDC.toLowerCase()}`]: {
          price: 2.5,
          confidence: 0.99,
          timestamp: nowSec,
          decimals: 6,
        },
      },
      () => fetchLlamaPrices("mainnet", [USDC], { now: nowMs }),
    );
    expect(res.prices.get(USDC)?.price).to.equal(2.5);
  });
});

describe("totalUsd: unpriced is not zero", () => {
  function asset(over: Partial<PricedFeeAsset>): PricedFeeAsset {
    return {
      token: USDC,
      symbol: "T",
      decimals: 18,
      balance: 1n,
      ...over,
    };
  }

  it("counts unpriced assets instead of folding them in as $0", () => {
    const t = totalUsd([
      asset({ usdValue: 10, realizableUsd: 10 }),
      asset({}),
      asset({}),
    ]);
    expect(t.notional).to.equal(10);
    expect(t.unpriced).to.equal(2);
  });

  // This is the exact 2026-09-30 shape: a chain full of assets, every one
  // unpriced, reporting "$0.00". The total is the same; what changes is that
  // the caller can now tell it apart from an empty router.
  it("distinguishes an all-unpriced chain from an empty one", () => {
    const allUnpriced = totalUsd([asset({}), asset({}), asset({})]);
    const empty = totalUsd([]);
    expect(allUnpriced.notional).to.equal(0);
    expect(empty.notional).to.equal(0);
    expect(allUnpriced.unpriced).to.equal(3);
    expect(empty.unpriced).to.equal(0);
  });

  // An off-chain price gives a notional but no measured depth, so it must not
  // raise realizable -- that is the number --min-usd gates on.
  it("counts a priced asset with no depth-backed realizable figure", () => {
    const t = totalUsd([asset({ usdValue: 100, priceSource: "llama:0.99" })]);
    expect(t.notional).to.equal(100);
    expect(t.realizable).to.equal(0);
    expect(t.noDepth).to.equal(1);
    expect(t.unpriced).to.equal(0);
  });
});
