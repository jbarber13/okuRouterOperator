/**
 * FeeTokens.ts
 *
 * Offline tests for the curated sweep list (util/feeTokens.ts) and the
 * sweepAll encoding it feeds (util/sweepCall.ts).
 *
 * What matters most here:
 *   - the mode rule picks `full` only when the zero-balance entries are cheap,
 *     and resolves an UNKNOWN cost to `nonzero`;
 *   - a hand edit to data/fee-tokens.json cannot put a sweep-breaking address
 *     into calldata;
 *   - calldata order is canonical, so a full list produces identical bytes
 *     every cycle.
 */
import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  bisectFailures,
  chooseSweepMode,
  emptyFeeTokens,
  loadFeeTokens,
  parseFeeTokens,
  saveFeeTokens,
  sortTokens,
  sweepTokensFor,
  DEFAULT_MODE_OVERRIDES,
  type FeeTokensFile,
} from "../../util/feeTokens";
import { decodeSweepAll, encodeSweepAll, SWEEP_ALL_SELECTOR } from "../../util/sweepCall";
import { getAddress } from "ethers";

const A = getAddress("0x00000000000000000000000000000000000000aa");
const B = getAddress("0x0000000000000000000000000000000000000bb0");
const C = getAddress("0xc000000000000000000000000000000000000000");
const POSI = "0x5CA42204cDaa70d5c773946e69dE942b85CA6706"; // UNSWEEPABLE on bsc
const OP_LEGACY_ETH = "0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000"; // NOT_A_TOKEN
const RECIPIENT = "0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C";

function entry(address: string) {
  return { address, symbol: "T", decimals: 18, source: "test", addedAt: "2026-10-17" };
}

describe("feeTokens: chooseSweepMode", () => {
  const base = { maxUsd: 0.1, zeroEntries: 100 };
  const gwei = 1_000_000_000n;

  it("auto picks full when the empty entries cost <= the limit", () => {
    // 100 entries * 8.2k gas = 820k gas at 0.01 gwei * $2,500 = $0.0205
    const d = chooseSweepMode({ ...base, configured: "auto", extraGas: 820_000n, gasPriceWei: gwei / 100n, nativeUsd: 2500 });
    expect(d.mode).to.equal("full");
    expect(d.extraUsd).to.be.closeTo(0.0205, 1e-6);
  });

  it("auto picks nonzero when the empty entries cost more than the limit", () => {
    // rootstock-like: 1.64M gas * 0.026 gwei * $82,000 = $3.50
    const d = chooseSweepMode({ ...base, configured: "auto", extraGas: 1_640_000n, gasPriceWei: 26_000_000n, nativeUsd: 82_000 });
    expect(d.mode).to.equal("nonzero");
    expect(d.reason).to.match(/> \$0\.10/);
  });

  it("the limit is inclusive", () => {
    // exactly $0.10: 1e6 gas * 1 gwei * $100 = $0.10
    const d = chooseSweepMode({ ...base, configured: "auto", extraGas: 1_000_000n, gasPriceWei: gwei, nativeUsd: 100 });
    expect(d.mode).to.equal("full");
  });

  for (const missing of ["extraGas", "gasPriceWei", "nativeUsd"] as const) {
    it(`auto resolves to nonzero when ${missing} is unknown`, () => {
      const args = { ...base, configured: "auto" as const, extraGas: 1n as bigint | null, gasPriceWei: 1n as bigint | null, nativeUsd: 1 as number | null };
      args[missing] = null;
      const d = chooseSweepMode(args);
      expect(d.mode).to.equal("nonzero");
      expect(d.extraUsd).to.equal(null);
      expect(d.reason).to.match(/unavailable/);
    });
  }

  it("a zero native price counts as unknown, not free", () => {
    const d = chooseSweepMode({ ...base, configured: "auto", extraGas: 1n, gasPriceWei: 1n, nativeUsd: 0 });
    expect(d.mode).to.equal("nonzero");
  });

  it("auto with no empty entries is full regardless of price", () => {
    const d = chooseSweepMode({ ...base, zeroEntries: 0, configured: "auto", extraGas: null, gasPriceWei: null, nativeUsd: null });
    expect(d.mode).to.equal("full");
  });

  it("configured modes are honoured whatever the cost", () => {
    const pricey = { ...base, extraGas: 10_000_000n, gasPriceWei: 100n * gwei, nativeUsd: 5000 };
    expect(chooseSweepMode({ ...pricey, configured: "full" }).mode).to.equal("full");
    const cheap = { ...base, extraGas: 1n, gasPriceWei: 1n, nativeUsd: 1 };
    expect(chooseSweepMode({ ...cheap, configured: "nonzero" }).mode).to.equal("nonzero");
  });

  it("mainnet defaults to nonzero", () => {
    expect(DEFAULT_MODE_OVERRIDES[1]).to.equal("nonzero");
  });
});

describe("feeTokens: list handling", () => {
  it("sorts canonically by lowercase address, independent of insertion order", () => {
    const one = sortTokens([entry(C), entry(A), entry(B)]).map((t) => t.address);
    const two = sortTokens([entry(B), entry(C), entry(A)]).map((t) => t.address);
    expect(one).to.deep.equal([A, B, C]);
    expect(two).to.deep.equal(one);
  });

  it("re-applies NOT_A_TOKEN and UNSWEEPABLE even if hand-edited into the file", () => {
    const f: FeeTokensFile = emptyFeeTokens();
    f.chains["56"] = { network: "bsc", mode: "auto", tokens: [entry(A), entry(POSI), entry(OP_LEGACY_ETH)] };
    const { tokens, dropped } = sweepTokensFor(f, 56);
    expect(tokens.map((t) => t.address)).to.deep.equal([A]);
    expect(dropped.map((d) => d.address).sort()).to.deep.equal([OP_LEGACY_ETH, POSI].sort());
  });

  it("an unknown chain yields no tokens rather than throwing", () => {
    expect(sweepTokensFor(emptyFeeTokens(), 12345).tokens).to.deep.equal([]);
  });

  it("rejects malformed files", () => {
    expect(() => parseFeeTokens({})).to.throw(/oku-fee-tokens/);
    const f = emptyFeeTokens() as unknown as Record<string, unknown>;
    (f as unknown as FeeTokensFile).chains["1"] = { network: "x", mode: "sometimes" as never, tokens: [] };
    expect(() => parseFeeTokens(f)).to.throw(/invalid mode/);
    const g = emptyFeeTokens();
    g.chains["1"] = { network: "x", mode: "auto", tokens: [entry(A), entry(A.toLowerCase())] };
    expect(() => parseFeeTokens(g)).to.throw(/twice/);
    const h = emptyFeeTokens();
    h.chains["1"] = { network: "x", mode: "auto", tokens: [entry("0x1234")] };
    expect(() => parseFeeTokens(h)).to.throw(/malformed/);
  });

  it("save/load round-trips and writes chains and tokens in canonical order", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "feetokens-")), "fee-tokens.json");
    const f = emptyFeeTokens();
    f.chains["8453"] = { network: "base", mode: "auto", tokens: [entry(C), entry(A)] };
    f.chains["10"] = { network: "op", mode: "full", tokens: [entry(B)] };
    saveFeeTokens(f, file);
    const back = loadFeeTokens(file);
    expect(Object.keys(back.chains)).to.deep.equal(["10", "8453"]);
    expect(back.chains["8453"].tokens.map((t) => t.address)).to.deep.equal([A, C]);
  });

  it("the committed data/fee-tokens.json parses and covers mainnet as nonzero", () => {
    const f = loadFeeTokens();
    expect(f.fullSweepMaxUsd).to.equal(0.1);
    expect(f.chains["1"]?.mode).to.equal("nonzero");
    for (const [id, c] of Object.entries(f.chains)) {
      const addrs = c.tokens.map((t) => t.address);
      expect(addrs, `chain ${id} order`).to.deep.equal(sortTokens(c.tokens).map((t) => t.address));
    }
  });
});

describe("feeTokens: bisectFailures", () => {
  it("finds every failing item and nothing else", async () => {
    const bad = new Set([3, 17, 18]);
    let calls = 0;
    const found = await bisectFailures([...Array(40).keys()], async (s) => {
      calls++;
      return !s.some((x) => bad.has(x));
    });
    expect(found.sort((a, b) => a - b)).to.deep.equal([3, 17, 18]);
    expect(calls).to.be.lessThan(40);
  });

  it("returns [] for a passing list in one call", async () => {
    let calls = 0;
    expect(await bisectFailures([1, 2, 3], async () => (calls++, true))).to.deep.equal([]);
    expect(calls).to.equal(1);
  });

  it("reports the whole group when it only fails in combination", async () => {
    const found = await bisectFailures([1, 2], async (s) => s.length < 2);
    expect(found).to.deep.equal([1, 2]);
  });
});

describe("sweepCall: sweepAll encoding", () => {
  it("round-trips and uses the sweepAll selector", () => {
    const data = encodeSweepAll([A, B], true, RECIPIENT);
    expect(data.slice(0, 10)).to.equal(SWEEP_ALL_SELECTOR);
    const d = decodeSweepAll(data);
    expect(d.tokens).to.deep.equal([A, B]);
    expect(d.includeEth).to.equal(true);
    expect(d.to).to.equal(RECIPIENT);
  });

  it("the same sorted list encodes to identical bytes", () => {
    const x = encodeSweepAll(sortTokens([entry(C), entry(A)]).map((t) => t.address), true, RECIPIENT);
    const y = encodeSweepAll(sortTokens([entry(A), entry(C)]).map((t) => t.address), true, RECIPIENT);
    expect(x).to.equal(y);
  });
});
