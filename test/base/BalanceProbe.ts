/**
 * BalanceProbe.ts
 *
 * Offline tests for the Multicall3 balance probe.
 *
 * The property under test is narrow but load-bearing: the probe must never
 * report a short list as if it were a complete one. A batch that was refused,
 * a Multicall3 that is not deployed, and a token that genuinely holds nothing
 * all produce "no balance" at the call site, and only one of those means the
 * router is empty. Every test here is about keeping those three apart.
 *
 * Nothing in this file touches a network.
 */
import { expect } from "chai";
import { AbiCoder, getAddress, Interface } from "ethers";
import {
  CANONICAL_MULTICALL3,
  MIN_BATCH_SIZE,
  multicallAddressFor,
  probeBalances,
  type BalanceProbeProvider,
} from "../../util/balanceProbe";

const CODER = AbiCoder.defaultAbiCoder();

const MULTICALL_IFACE = new Interface([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)",
]);

const HOLDER = "0xb1f3a7B816B0681188F54dFa400991B93ADf00ed";

/**
 * Deterministic pseudo-token addresses, CHECKSUMMED.
 *
 * The probe keys its result map by checksummed address, so a test helper
 * returning lowercase would only appear to work for addresses whose hex
 * happens to contain no letters -- which is exactly how an earlier version of
 * this file passed while asserting nothing.
 */
function token(i: number): string {
  return getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`);
}

function word(v: bigint): string {
  return CODER.encode(["uint256"], [v]);
}

interface FakeOpts {
  /** lowercased token address -> balance to report. */
  balances?: Record<string, bigint>;
  /** Reject any batch larger than this, as a gas-capped node would. */
  maxBatch?: number;
  /** Reject every batch regardless of size. */
  alwaysFail?: boolean;
  /** Bytecode to report at the multicall address. */
  code?: string;
  /** Tokens whose call reverts (success=false). */
  reverting?: Set<string>;
  /** Tokens that return success with a short/empty payload. */
  shortReturn?: Set<string>;
}

function fakeProvider(opts: FakeOpts = {}): {
  provider: BalanceProbeProvider;
  batches: number[];
} {
  const batches: number[] = [];
  const provider: BalanceProbeProvider = {
    getCode: async () => opts.code ?? "0x60006000",
    call: async (tx: { to?: string | null; data?: string }) => {
      const decoded = MULTICALL_IFACE.decodeFunctionData("aggregate3", tx.data ?? "0x");
      const calls = decoded[0] as Array<{ target: string }>;
      batches.push(calls.length);
      if (opts.alwaysFail) throw new Error("execution reverted");
      if (opts.maxBatch !== undefined && calls.length > opts.maxBatch) {
        throw new Error("out of gas");
      }
      const results = calls.map((c) => {
        const addr = c.target.toLowerCase();
        if (opts.reverting?.has(addr)) return { success: false, returnData: "0x" };
        if (opts.shortReturn?.has(addr)) return { success: true, returnData: "0x" };
        const bal = opts.balances?.[addr] ?? 0n;
        return { success: true, returnData: word(bal) };
      });
      return MULTICALL_IFACE.encodeFunctionResult("aggregate3", [results]);
    },
  } as unknown as BalanceProbeProvider;
  return { provider, batches };
}

describe("balanceProbe: multicall address resolution", () => {
  it("prefers the chain-config address over the canonical one", () => {
    const addr = multicallAddressFor({
      chain: { contracts: { multicall3: { address: "0x0b1795cca8e4ec4df02346a082df54d437f8d9af" } } },
    });
    expect(addr).to.equal("0x0B1795ccA8E4eC4df02346a082df54D437F8D9aF");
  });

  it("returns undefined when chain-config has no entry, so the caller falls back", () => {
    expect(multicallAddressFor({ chain: {} })).to.equal(undefined);
    expect(multicallAddressFor(undefined)).to.equal(undefined);
  });

  // xdc deploys Multicall3 at a non-canonical address. Probing the canonical
  // one there found no code and skipped the chain entirely, which is exactly
  // the silent-zero failure this module is supposed to prevent.
  it("does not assume the canonical address is universal", () => {
    const xdc = multicallAddressFor({
      chain: { contracts: { multicall3: { address: "0x0b1795cca8e4ec4df02346a082df54d437f8d9af" } } },
    });
    expect(xdc).to.not.equal(CANONICAL_MULTICALL3);
  });
});

describe("balanceProbe: reading balances", () => {
  it("returns only non-zero balances", async () => {
    const { provider } = fakeProvider({
      balances: { [token(0).toLowerCase()]: 5n, [token(2).toLowerCase()]: 7n },
    });
    const res = await probeBalances(provider, HOLDER, [token(0), token(1), token(2)]);
    expect(res.available).to.equal(true);
    expect(res.balances.size).to.equal(2);
    expect(res.balances.get(token(0))).to.equal(5n);
    expect(res.balances.get(token(2))).to.equal(7n);
    expect(res.balances.has(token(1))).to.equal(false);
    expect(res.unchecked).to.equal(0);
  });

  it("drops individually reverting tokens without losing the rest of the batch", async () => {
    const { provider } = fakeProvider({
      balances: { [token(0).toLowerCase()]: 5n, [token(1).toLowerCase()]: 9n },
      reverting: new Set([token(1).toLowerCase()]),
    });
    const res = await probeBalances(provider, HOLDER, [token(0), token(1)]);
    expect(res.balances.size).to.equal(1);
    expect(res.balances.get(token(0))).to.equal(5n);
  });

  // A non-standard token can return success with no payload. Treating that as
  // a number would be inventing one.
  it("ignores a successful call that returned no usable word", async () => {
    const { provider } = fakeProvider({
      balances: { [token(0).toLowerCase()]: 5n },
      shortReturn: new Set([token(0).toLowerCase()]),
    });
    const res = await probeBalances(provider, HOLDER, [token(0)]);
    expect(res.balances.size).to.equal(0);
  });

  it("batches according to batchSize", async () => {
    const { provider, batches } = fakeProvider();
    const tokens = Array.from({ length: 250 }, (_, i) => token(i));
    await probeBalances(provider, HOLDER, tokens, { batchSize: 100 });
    expect(batches).to.deep.equal([100, 100, 50]);
  });
});

describe("balanceProbe: failure is never reported as an empty router", () => {
  it("reports available:false when Multicall3 has no code", async () => {
    const { provider } = fakeProvider({ code: "0x" });
    const res = await probeBalances(provider, HOLDER, [token(0), token(1)]);
    expect(res.available).to.equal(false);
    expect(res.balances.size).to.equal(0);
    // The candidates were NOT checked, and the result says so.
    expect(res.unchecked).to.equal(2);
    expect(res.warnings.join(" ")).to.match(/not deployed/i);
  });

  it("splits an oversized batch rather than losing it", async () => {
    const { provider, batches } = fakeProvider({
      maxBatch: 64,
      balances: { [token(200).toLowerCase()]: 42n },
    });
    const tokens = Array.from({ length: 256 }, (_, i) => token(i));
    const res = await probeBalances(provider, HOLDER, tokens, { batchSize: 256 });
    expect(res.available).to.equal(true);
    expect(res.unchecked).to.equal(0);
    // The token sitting in the middle of a rejected batch still came back.
    expect(res.balances.get(token(200))).to.equal(42n);
    // The first attempt was the full batch, and smaller ones followed it.
    expect(batches[0]).to.equal(256);
    expect(batches.some((b) => b <= 64)).to.equal(true);
  });

  it("counts candidates it could not check, instead of implying zero", async () => {
    const { provider } = fakeProvider({ alwaysFail: true });
    const tokens = Array.from({ length: MIN_BATCH_SIZE * 2 }, (_, i) => token(i));
    const res = await probeBalances(provider, HOLDER, tokens, { batchSize: MIN_BATCH_SIZE * 2 });
    expect(res.balances.size).to.equal(0);
    expect(res.unchecked).to.equal(tokens.length);
    expect(res.warnings.join(" ")).to.match(/NOT checked/i);
  });

  it("stops halving at MIN_BATCH_SIZE rather than hammering a failing node", async () => {
    const { provider, batches } = fakeProvider({ alwaysFail: true });
    const tokens = Array.from({ length: MIN_BATCH_SIZE * 4 }, (_, i) => token(i));
    await probeBalances(provider, HOLDER, tokens, { batchSize: MIN_BATCH_SIZE * 4 });
    expect(batches.every((b) => b >= MIN_BATCH_SIZE)).to.equal(true);
  });

  it("refuses a malformed holder address", async () => {
    const { provider } = fakeProvider();
    const res = await probeBalances(provider, "not-an-address", [token(0)]);
    expect(res.available).to.equal(false);
    expect(res.unchecked).to.equal(1);
  });

  it("treats an empty candidate set as success, not failure", async () => {
    const { provider } = fakeProvider();
    const res = await probeBalances(provider, HOLDER, []);
    expect(res.available).to.equal(true);
    expect(res.calls).to.equal(0);
    expect(res.unchecked).to.equal(0);
  });
});
