/**
 * RpcEndpoints.ts
 *
 * Offline tests for general-RPC endpoint resolution.
 *
 * The eth_getLogs half of this file is gone along with log-based discovery:
 * there is no longer a separate logs endpoint, a log-range cap, or a coverage
 * verdict to get wrong. What remains is the Ankr entitlement map and the
 * curated general endpoints.
 *
 * Nothing in this file touches a network.
 */
import { expect } from "chai";
import {
  ankrUrl,
  curatedRpc,
  isAnkrEntitled,
  SHALLOW_ARCHIVE,
} from "../../util/rpcEndpoints";

describe("rpcEndpoints: Ankr entitlement", () => {
  const KEY = "ANKR_FREEMIUM_API_KEY";
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[KEY];
    process.env[KEY] = "f".repeat(64);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("builds a keyed URL for entitled chains", () => {
    expect(ankrUrl("avax")).to.equal(`https://rpc.ankr.com/avalanche/${"f".repeat(64)}`);
    expect(ankrUrl("mainnet")).to.equal(`https://rpc.ankr.com/eth/${"f".repeat(64)}`);
  });

  it("uses the _mainnet slug variants Ankr actually requires", () => {
    // The bare slugs 403 for these; the suffixed ones are what work.
    for (const [net, slug] of [
      ["monad", "monad_mainnet"],
      ["redbelly", "redbelly_mainnet"],
      ["goat", "goat_mainnet"],
      ["etherlink", "etherlink_mainnet"],
    ] as const) {
      expect(ankrUrl(net), net).to.contain(`/${slug}/`);
    }
  });

  it("returns undefined for chains the Freemium plan is not entitled to", () => {
    // Premium-gated, confirmed against the Ankr dashboard.
    for (const net of ["op", "linea", "mantle", "scroll", "sei", "telos", "zerog"]) {
      expect(isAnkrEntitled(net), net).to.equal(false);
      expect(ankrUrl(net), net).to.equal(undefined);
    }
  });

  it("returns undefined for chains Ankr does not serve at all", () => {
    for (const net of ["rootstock", "unichain", "worldchain", "hyperevm", "bob", "gensyn"]) {
      expect(isAnkrEntitled(net), net).to.equal(false);
    }
  });

  it("degrades to undefined when no key is configured, rather than emitting a broken URL", () => {
    delete process.env[KEY];
    expect(ankrUrl("avax")).to.equal(undefined);
    // ...and the caller then falls through to its own default chain.
    expect(curatedRpc("avax")).to.equal(undefined);
  });
});

describe("implausible-quote guard", () => {
  // Regression: base token `UP` quoted $3.4e50/token against a pool holding
  // $1.25, producing a $2.1e50 line item that made the entire scan's notional
  // total read as 2.1e50 dollars. Realizable was correct throughout (it is
  // capped at a fraction of pool depth), which is precisely why it went
  // unnoticed -- only the notional column was nonsense.
  //
  // This pins the arithmetic of the rule rather than re-deriving prices,
  // since priceAssets needs a live provider.
  const RATIO = 1e6;
  const credible = (usd: number, depth: number) => usd <= depth * RATIO;

  it("rejects the observed base UP quote", () => {
    expect(credible(2.107260876583047e50, 1.249765)).to.equal(false);
  });

  it("accepts a router holding far more than pool depth, but plausibly so", () => {
    // $10k of a token whose pool holds $100 -- 100x. Odd, not impossible, and
    // realizable already reports it honestly.
    expect(credible(10_000, 100)).to.equal(true);
  });

  it("accepts ordinary assets comfortably", () => {
    expect(credible(1173.23, 500_000)).to.equal(true);
    expect(credible(0.06, 12.5)).to.equal(true);
  });

  it("puts the boundary exactly at the ratio", () => {
    expect(credible(1_000_000, 1)).to.equal(true);
    expect(credible(1_000_001, 1)).to.equal(false);
  });
});
