/**
 * RpcEndpoints.ts
 *
 * Offline tests for endpoint resolution and the discovery-quality verdict.
 *
 * These two things together are what failed on 2026-09-29: Alchemy's 10-block
 * eth_getLogs cap silently became the discovery window, and the resulting
 * near-zero coverage was reported as a clean "$0.00". Both halves are now
 * pinned here.
 *
 * Nothing in this file touches a network.
 */
import { expect } from "chai";
import {
  ankrUrl,
  curatedLogsRpc,
  curatedRpc,
  isAnkrEntitled,
  NO_LOGS_ENDPOINT,
  SHALLOW_ARCHIVE,
} from "../../util/rpcEndpoints";
import {
  coverageFraction,
  discoveryQuality,
  UNRELIABLE_COVERAGE_FRACTION,
  type ScanCoverage,
} from "../../util/feeScan";
import { resolveLogsRpc, logsEnvVar } from "../../util/safeChains";

/** A coverage record with sane defaults, overridable per test. */
function coverage(over: Partial<ScanCoverage> = {}): ScanCoverage {
  return {
    fromBlock: 0,
    toBlock: 999,
    rangeUsed: 1000,
    partial: false,
    events: 0,
    everSeen: 0,
    refusedWindows: 0,
    scannedThrough: 999,
    ...over,
  };
}

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

describe("rpcEndpoints: general vs logs split", () => {
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

  it("prefers Ankr for BOTH on the chains where it wins outright", () => {
    for (const net of ["mainnet", "base", "arbitrum", "avax", "bsc", "polygon"]) {
      expect(curatedRpc(net), `${net} rpc`).to.contain("rpc.ankr.com");
      expect(curatedLogsRpc(net), `${net} logs`).to.contain("rpc.ankr.com");
    }
  });

  it("splits xdc and goat: Ankr for archive state, public endpoint for logs", () => {
    // Measured: xdc public archive depth 10 vs Ankr 1,000,000, but public
    // getLogs span 10,000 vs Ankr 2,000. goat is the same shape, more extreme
    // (public logs 10,000,000 vs Ankr 2,000).
    for (const net of ["xdc", "goat"]) {
      expect(curatedRpc(net), `${net} rpc`).to.contain("rpc.ankr.com");
      const logs = curatedLogsRpc(net);
      // Must be an explicit URL, not undefined: undefined would fall back to
      // the general RPC (Ankr) and silently undo the split.
      expect(logs, `${net} logs must be explicit`).to.be.a("string");
      expect(logs, `${net} logs`).to.not.contain("rpc.ankr.com");
    }
    expect(curatedLogsRpc("xdc")).to.equal("https://rpc.xdcrpc.com");
    expect(curatedLogsRpc("goat")).to.equal("https://rpc.goat.network");
  });

  it("does not move monad to Ankr, whose archive depth there is worse", () => {
    expect(curatedRpc("monad")).to.equal(undefined);
  });

  it("routes the chains Alchemy was capping at 10 blocks to their official endpoints", () => {
    const expected: Record<string, string> = {
      op: "https://mainnet.optimism.io",
      scroll: "https://rpc.scroll.io",
      linea: "https://rpc.linea.build",
      mantle: "https://rpc.mantle.xyz",
      unichain: "https://mainnet.unichain.org",
    };
    for (const [net, url] of Object.entries(expected)) {
      expect(curatedRpc(net), `${net} rpc`).to.equal(url);
      expect(curatedLogsRpc(net), `${net} logs`).to.equal(url);
    }
  });

  it("records the chains where no endpoint serves logs at all", () => {
    expect(NO_LOGS_ENDPOINT.has("rootstock")).to.equal(true);
    expect(curatedLogsRpc("rootstock")).to.equal(undefined);
  });

  it("records chains whose best endpoint has only shallow archive state", () => {
    // fees:account reads balances around the execution block; these cannot.
    for (const net of ["filecoin", "saga", "nibiru", "robinhood"]) {
      expect(SHALLOW_ARCHIVE[net], net).to.be.a("number");
    }
  });
});

describe("rpcEndpoints: env override precedence", () => {
  const vars: string[] = [];
  afterEach(() => {
    for (const v of vars) delete process.env[v];
    vars.length = 0;
  });

  it("lets <NET>_LOGS_URL beat the curated default", () => {
    const v = logsEnvVar("base");
    vars.push(v);
    process.env[v] = "https://my-private-node.example/base";
    expect(resolveLogsRpc("base")).to.equal("https://my-private-node.example/base");
  });

  it("falls back to the curated default when the env var is absent or blank", () => {
    const v = logsEnvVar("op");
    vars.push(v);
    process.env[v] = "   ";
    expect(resolveLogsRpc("op")).to.equal("https://mainnet.optimism.io");
  });

  it("keeps the arbitrum ARB_ prefix deviation intact", () => {
    expect(logsEnvVar("arbitrum")).to.equal("ARB_LOGS_URL");
  });
});

describe("discoveryQuality", () => {
  it("calls a full, unrefused scan complete", () => {
    expect(discoveryQuality(coverage({ partial: false, refusedWindows: 0 }), 1000)).to.equal(
      "complete",
    );
  });

  it("calls a null coverage unreliable -- the endpoint refused logs outright", () => {
    expect(discoveryQuality(null, 1_000_000)).to.equal("unreliable");
  });

  it("reproduces the avax failure: 4k blocks of 96M history is UNRELIABLE, not partial", () => {
    const cov = coverage({
      fromBlock: 96_402_356,
      toBlock: 96_406_355,
      partial: true,
      everSeen: 1,
      scannedThrough: 96_406_355,
    });
    expect(coverageFraction(cov, 96_406_355)).to.be.lessThan(0.0001);
    expect(discoveryQuality(cov, 96_406_355)).to.equal("unreliable");
  });

  it("calls a genuinely partial scan partial, not unreliable", () => {
    // Half of history seen: incomplete, but real evidence.
    const cov = coverage({ fromBlock: 500, toBlock: 1000, partial: true });
    expect(discoveryQuality(cov, 1000)).to.equal("partial");
  });

  it("puts the boundary exactly at the documented fraction", () => {
    const span = 1_000_000;
    const justUnder = Math.floor(span * UNRELIABLE_COVERAGE_FRACTION) - 1;
    const justOver = Math.ceil(span * UNRELIABLE_COVERAGE_FRACTION) + 1;
    expect(
      discoveryQuality(coverage({ fromBlock: 0, toBlock: justUnder - 1, partial: true }), span),
    ).to.equal("unreliable");
    expect(
      discoveryQuality(coverage({ fromBlock: 0, toBlock: justOver - 1, partial: true }), span),
    ).to.equal("partial");
  });

  it("treats a mid-scan refusal as not-complete even when the window looks full", () => {
    // A hole in the middle means assets first traded inside it are invisible.
    const cov = coverage({ partial: false, refusedWindows: 3 });
    expect(discoveryQuality(cov, 1000)).to.not.equal("complete");
  });

  it("errs toward the worse verdict when history span is unknown (0)", () => {
    expect(discoveryQuality(coverage({ partial: true }), 0)).to.equal("partial");
    expect(discoveryQuality(coverage({ partial: false, refusedWindows: 0 }), 0)).to.equal(
      "complete",
    );
  });

  it("never reports more than 100% coverage", () => {
    expect(coverageFraction(coverage({ fromBlock: 0, toBlock: 5000 }), 1000)).to.equal(1);
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
