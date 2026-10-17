/**
 * SafeTxVerify.ts
 *
 * Tests for scripts/safeSignPage/safeTxVerify.js -- the dependency-free code
 * the sign page runs to recompute hashes, decode calldata and refuse bad
 * payloads before anything reaches a wallet.
 *
 * The page cannot use ethers, so its keccak and EIP-712 hashing are checked
 * here against ethers on every bundle in safe-bundles/ plus synthetic ones.
 */
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { TypedDataEncoder, Wallet, getAddress, keccak256, randomBytes, toUtf8Bytes, hexlify } from "ethers";
import { SAFE_TX_TYPES, buildBatchedSafeTx, hashSafeTx, safeDomain } from "../../util/safeTx";
import { encodeSweepAll } from "../../util/sweepCall";

const V = require("../../scripts/safeSignPage/safeTxVerify.js");

const BUNDLES = path.resolve(__dirname, "..", "..", "safe-bundles");
const SAFE = "0x37333A9626E99eC2012F3cC47a062649CF741303";
const ROUTER = "0xb1f3a7B816B0681188F54dFa400991B93ADf00ed";
const RECIPIENT = "0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C";
const TOKENS = [
  "0x000000000000780555bD0BCA3791f89f9542c2d6",
  "0x07c57E32a3C29D5659bda1d3EFC2E7BF004E3035",
];

/** A sweep bundle chain built with the same code safe:build uses. */
function sweepBundle(overrides: { tokens?: string[]; includeEth?: boolean } = {}) {
  const tokens = overrides.tokens ?? TOKENS;
  const includeEth = overrides.includeEth ?? true;
  const data = encodeSweepAll(tokens, includeEth, RECIPIENT);
  const tx = buildBatchedSafeTx([{ to: ROUTER, data, value: 0n }], 3n);
  const chain = {
    network: "hyperevm",
    chainId: 999,
    router: ROUTER,
    nonce: "3",
    calls: [{ to: ROUTER, data, value: "0", label: "x" }],
    tx: {
      to: tx.to, value: "0", data: tx.data, operation: 0, safeTxGas: "0", baseGas: "0",
      gasPrice: "0", gasToken: tx.gasToken, refundReceiver: tx.refundReceiver, nonce: "3",
    },
    safeTxHash: hashSafeTx(999, SAFE, tx),
    eip712: JSON.parse(JSON.stringify(TypedDataEncoder.getPayload(safeDomain(999, SAFE), SAFE_TX_TYPES, tx))),
    signatures: [],
    sweep: {
      recipient: RECIPIENT, includeEth, assets: [], usdNotional: 0, unpricedCount: 0,
      mode: "full", tokens: tokens.map((t) => ({ token: t, symbol: "T" })),
    },
  };
  const bundle = { name: "t", intent: "sweep", params: { recipient: RECIPIENT }, safe: SAFE, threshold: 2, owners: [], chains: [chain] };
  return { bundle, chain };
}

describe("safeTxVerify: primitives", () => {
  it("keccak256 matches ethers across block boundaries", () => {
    for (const n of [0, 1, 31, 32, 135, 136, 137, 271, 272, 1000, 10148]) {
      const b = randomBytes(n);
      expect(V.bytesToHex(V.keccak256(b)), `len ${n}`).to.equal(keccak256(b));
    }
    expect(V.bytesToHex(V.keccak256(toUtf8Bytes("abc")))).to.equal(keccak256(toUtf8Bytes("abc")));
  });

  it("checksum matches EIP-55 (ethers getAddress)", () => {
    for (let i = 0; i < 20; i++) {
      const a = hexlify(randomBytes(20));
      expect(V.checksum(a)).to.equal(getAddress(a));
    }
  });
});

describe("safeTxVerify: hashes", () => {
  it("matches ethers on every chain of every bundle in safe-bundles/", () => {
    let n = 0;
    for (const f of fs.readdirSync(BUNDLES).filter((x) => x.endsWith(".json"))) {
      const b = JSON.parse(fs.readFileSync(path.join(BUNDLES, f), "utf8"));
      for (const c of b.chains ?? []) {
        const h = V.hashSafeTxPayload(c.eip712);
        const types = { SafeTx: c.eip712.types.SafeTx };
        expect(h.safeTxHash, `${f}:${c.network}`).to.equal(TypedDataEncoder.hash(c.eip712.domain, types, c.eip712.message));
        expect(h.domainSeparator).to.equal(TypedDataEncoder.hashDomain(c.eip712.domain));
        expect(h.messageHash).to.equal(TypedDataEncoder.from(types).hash(c.eip712.message));
        expect(h.safeTxHash).to.equal(String(c.safeTxHash).toLowerCase());
        n++;
      }
    }
    expect(n).to.be.greaterThan(100);
  });

  it("a wallet signature over the payload recovers via the page's safeTxHash", async () => {
    const { chain } = sweepBundle();
    const w = Wallet.createRandom();
    const sig = await w.signTypedData(chain.eip712.domain, { SafeTx: chain.eip712.types.SafeTx }, chain.eip712.message);
    const { recoverAddress } = await import("ethers");
    expect(recoverAddress(V.hashSafeTxPayload(chain.eip712).safeTxHash, sig)).to.equal(w.address);
  });

  it("refuses payloads whose type lists are not canonical", () => {
    const { chain } = sweepBundle();
    const p = JSON.parse(JSON.stringify(chain.eip712));
    p.types.SafeTx = p.types.SafeTx.slice(0, 9);
    expect(() => V.hashSafeTxPayload(p)).to.throw(/canonical/);
    const q = JSON.parse(JSON.stringify(chain.eip712));
    q.domain.name = "Safe";
    expect(() => V.hashSafeTxPayload(q)).to.throw(/unexpected domain/);
    const r = JSON.parse(JSON.stringify(chain.eip712));
    r.types.Extra = [];
    expect(() => V.hashSafeTxPayload(r)).to.throw(/unexpected EIP-712 types/);
  });
});

describe("safeTxVerify: decodeSweepAll", () => {
  it("decodes the canonical encoding", () => {
    const d = V.decodeSweepAll(encodeSweepAll(TOKENS, false, RECIPIENT));
    expect(d.tokens).to.deep.equal(TOKENS);
    expect(d.includeEth).to.equal(false);
    expect(d.to).to.equal(RECIPIENT);
  });

  it("decodes an empty token list (native only)", () => {
    expect(V.decodeSweepAll(encodeSweepAll([], true, RECIPIENT)).tokens).to.deep.equal([]);
  });

  it("rejects non-canonical encodings", () => {
    const good = encodeSweepAll(TOKENS, true, RECIPIENT);
    expect(() => V.decodeSweepAll("0x12345678" + good.slice(10))).to.throw(/selector/);
    expect(() => V.decodeSweepAll(good + "00".repeat(32))).to.throw(/does not match/);
    expect(() => V.decodeSweepAll(good.slice(0, -64))).to.throw(/does not match/);
    // dirty bool
    const w1 = good.slice(0, 10 + 64) + "0".repeat(63) + "2" + good.slice(10 + 128);
    expect(() => V.decodeSweepAll(w1)).to.throw(/clean bool/);
    // dirty high bytes on recipient
    const w2 = good.slice(0, 10 + 128) + "ff" + good.slice(10 + 130);
    expect(() => V.decodeSweepAll(w2)).to.throw(/dirty/);
    // wrong offset
    const w3 = good.slice(0, 10) + "0".repeat(62) + "80" + good.slice(10 + 64);
    expect(() => V.decodeSweepAll(w3)).to.throw(/offset/);
  });
});

describe("safeTxVerify: verifyChain refusals", () => {
  it("accepts a correctly built sweep and exposes the device view", () => {
    const { bundle, chain } = sweepBundle();
    const r = V.verifyChain(bundle, chain);
    expect(r.errors).to.deep.equal([]);
    expect(r.ok).to.equal(true);
    expect(r.view.decoded.tokens).to.deep.equal(TOKENS);
    expect(r.view.fields.map((f: { name: string }) => f.name)).to.deep.equal([
      "chainId", "verifyingContract", "to", "value", "data", "operation",
      "safeTxGas", "baseGas", "gasPrice", "gasToken", "refundReceiver", "nonce",
    ]);
  });

  const cases: [string, (b: ReturnType<typeof sweepBundle>) => void, RegExp][] = [
    ["bundle safeTxHash mismatch", ({ chain }) => { chain.safeTxHash = "0x" + "11".repeat(32); }, /recomputed safeTxHash/],
    ["wrong domain chainId", ({ chain }) => { chain.chainId = 1; }, /domain chainId/],
    ["wrong Safe", ({ bundle }) => { bundle.safe = RECIPIENT; }, /verifyingContract/],
    ["payload differs from tx record", ({ chain }) => { chain.tx.nonce = "4"; }, /payload nonce differs/],
    ["non-zero refundReceiver", ({ chain }) => { chain.eip712.message.refundReceiver = RECIPIENT; }, /refundReceiver must be/],
    ["non-zero gasPrice", ({ chain }) => { chain.eip712.message.gasPrice = "1"; }, /gasPrice must be 0/],
    ["delegatecall to router", ({ chain }) => { chain.eip712.message.operation = "1"; }, /DELEGATECALL/],
    ["sweep to wrong target", ({ chain }) => { chain.router = RECIPIENT; }, /must call this chain's router/],
    ["manifest recipient differs", ({ chain }) => { chain.sweep.recipient = ROUTER; }, /manifest recipient/],
    ["bundle recipient differs", ({ bundle }) => { bundle.params.recipient = ROUTER; }, /bundle recipient/],
    ["manifest token list differs", ({ chain }) => { chain.sweep.tokens.reverse(); }, /token array differs/],
    ["includeEth differs", ({ chain }) => { chain.sweep.includeEth = false; }, /includeEth differs/],
    ["call data differs", ({ chain }) => { chain.calls[0].data = encodeSweepAll([], true, RECIPIENT); }, /call data/],
    ["no manifest", ({ chain }) => { delete (chain as { sweep?: unknown }).sweep; }, /no manifest/],
  ];
  for (const [name, mutate, re] of cases) {
    it(`refuses: ${name}`, () => {
      const b = sweepBundle();
      mutate(b);
      const r = V.verifyChain(b.bundle, b.chain);
      expect(r.ok, name).to.equal(false);
      expect(r.errors.join(" | ")).to.match(re);
    });
  }

  it("allows a non-sweep MultiSendCallOnly batch, with a warning", () => {
    const calls = [
      { to: ROUTER, data: "0x1234", value: 0n },
      { to: ROUTER, data: "0x5678", value: 0n },
    ];
    const tx = buildBatchedSafeTx(calls, 1n);
    const chain = {
      network: "op", chainId: 10, router: ROUTER, nonce: "1",
      calls: calls.map((c) => ({ ...c, value: "0", label: "" })),
      tx: { to: tx.to, value: "0", data: tx.data, operation: 1, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: tx.gasToken, refundReceiver: tx.refundReceiver, nonce: "1" },
      safeTxHash: hashSafeTx(10, SAFE, tx),
      eip712: JSON.parse(JSON.stringify(TypedDataEncoder.getPayload(safeDomain(10, SAFE), SAFE_TX_TYPES, tx))),
    };
    const r = V.verifyChain({ intent: "swap-targets", safe: SAFE, params: {} }, chain);
    expect(r.errors).to.deep.equal([]);
    expect(r.warnings.join()).to.match(/MultiSendCallOnly/);
    // ...but never for a sweep
    const s = V.verifyChain({ intent: "sweep", safe: SAFE, params: {} }, chain);
    expect(s.ok).to.equal(false);
  });
});
