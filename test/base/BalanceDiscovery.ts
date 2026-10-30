/**
 * BalanceDiscovery.ts
 *
 * Offline tests for balance-API discovery (util/balanceDiscovery.ts) and the
 * step that turns its findings into curated-list additions
 * (util/feeDiscovery.ts).
 *
 * The properties that matter:
 *   - an incomplete provider answer (failed mid-pagination) is FAILED, never a
 *     short list that reads like a router holding less;
 *   - spam/dust/thin/unpriced tokens are ignored and recorded with the
 *     balance they were judged at, and are not re-evaluated until it grows;
 *   - only firm-priced >= threshold tokens that pass the vet are added;
 *   - the API's balance is never trusted: the on-chain read decides.
 *
 * Nothing in this file touches a network.
 */
import { expect } from "chai";
import { AbiCoder, getAddress, Interface } from "ethers";
import {
  alchemyHoldings,
  ankrHoldings,
  discoverHoldings,
  discoverySupported,
} from "../../util/balanceDiscovery";
import { applyDiscovery, judge, selectCandidates } from "../../util/feeDiscovery";
import { emptyFeeTokens, parseFeeTokens, type FeeTokensFile } from "../../util/feeTokens";
import type { BalanceProbeProvider } from "../../util/balanceProbe";
import type { PricedFeeAsset } from "../../util/feeScan";
import type { VetResult } from "../../util/feeTokenVet";
import type { SafeChain } from "../../util/safeChains";

const ROUTER = "0xb1f3a7B816B0681188F54dFa400991B93ADf00ed";
const SAFE = "0x37333A9626E99eC2012F3cC47a062649CF741303";
const T = (i: number) => getAddress(`0x${(i + 0x100).toString(16).padStart(40, "0")}`);
const OP_LEGACY_ETH = "0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000"; // NOT_A_TOKEN
const hex = (v: bigint) => "0x" + v.toString(16).padStart(64, "0");

type Handler = (url: string, body: Record<string, unknown>) => { status: number; json: unknown };
function fakeFetch(handler: Handler): { fn: typeof fetch; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const fn = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const { status, json } = handler(String(url), body);
    return { status, ok: status === 200, json: async () => json } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const FAST = { backoffMs: 0, retries: 2, timeoutMs: 1000 };

describe("balanceDiscovery: Alchemy Portfolio", () => {
  it("follows every page, drops zero balances and native", async () => {
    const { fn, calls } = fakeFetch((_u, b) =>
      b.pageKey
        ? { status: 200, json: { data: { tokens: [{ tokenAddress: T(3).toLowerCase(), tokenBalance: hex(7n) }] } } }
        : {
            status: 200,
            json: {
              data: {
                tokens: [
                  { tokenAddress: null, tokenBalance: hex(99n) },
                  { tokenAddress: T(1).toLowerCase(), tokenBalance: hex(5n) },
                  { tokenAddress: T(2).toLowerCase(), tokenBalance: hex(0n) },
                ],
                pageKey: "p2",
              },
            },
          },
    );
    const r = await alchemyHoldings("base", ROUTER, { ...FAST, alchemyKey: "k", fetchFn: fn });
    expect(r.ok).to.equal(true);
    expect([...r.balances.entries()]).to.deep.equal([
      [T(1), 5n],
      [T(3), 7n],
    ]);
    expect(calls).to.have.length(2);
    expect((calls[0].addresses as { networks: string[] }[])[0].networks).to.deep.equal(["base-mainnet"]);
  });

  it("a failure on page 2 fails the whole answer (no short lists)", async () => {
    const { fn } = fakeFetch((_u, b) =>
      b.pageKey
        ? { status: 500, json: { error: { message: "boom" } } }
        : { status: 200, json: { data: { tokens: [{ tokenAddress: T(1), tokenBalance: hex(5n) }], pageKey: "p2" } } },
    );
    const r = await alchemyHoldings("base", ROUTER, { ...FAST, alchemyKey: "k", fetchFn: fn });
    expect(r.ok).to.equal(false);
    expect(r.error).to.match(/HTTP 500/);
  });

  it("retries a 429 and then succeeds", async () => {
    let n = 0;
    const { fn } = fakeFetch(() =>
      n++ === 0 ? { status: 429, json: {} } : { status: 200, json: { data: { tokens: [] } } },
    );
    const r = await alchemyHoldings("base", ROUTER, { ...FAST, alchemyKey: "k", fetchFn: fn });
    expect(r.ok).to.equal(true);
    expect(n).to.equal(2);
  });

  it("caps pagination and treats the overflow as incomplete", async () => {
    const { fn } = fakeFetch(() => ({ status: 200, json: { data: { tokens: [], pageKey: "again" } } }));
    const r = await alchemyHoldings("base", ROUTER, { ...FAST, alchemyKey: "k", fetchFn: fn, maxPages: 3 });
    expect(r.ok).to.equal(false);
    expect(r.error).to.match(/more than 3 pages/);
  });

  it("is unsupported without a network id or key", async () => {
    expect((await alchemyHoldings("plasma", ROUTER, { alchemyKey: "k" })).error).to.equal("unsupported");
    expect((await alchemyHoldings("base", ROUTER, {})).error).to.equal("unsupported");
  });
});

describe("balanceDiscovery: Ankr", () => {
  it("splits one multichain answer per network, ERC20 only", async () => {
    const { fn, calls } = fakeFetch(() => ({
      status: 200,
      json: {
        result: {
          assets: [
            { blockchain: "eth", tokenType: "NATIVE", contractAddress: "0x0000000000000000000000000000000000000000", balanceRawInteger: "1" },
            { blockchain: "eth", tokenType: "ERC20", contractAddress: T(1).toLowerCase(), balanceRawInteger: "10" },
            { blockchain: "base", tokenType: "ERC20", contractAddress: T(2).toLowerCase(), balanceRawInteger: "20" },
            { blockchain: "base", tokenType: "ERC20", contractAddress: T(3).toLowerCase(), balanceRawInteger: "0" },
          ],
        },
      },
    }));
    const r = await ankrHoldings(ROUTER, ["mainnet", "base", "plasma"], { ...FAST, ankrKey: "k", fetchFn: fn });
    expect(r.has("plasma")).to.equal(false);
    expect([...r.get("mainnet")!.balances]).to.deep.equal([[T(1), 10n]]);
    expect([...r.get("base")!.balances]).to.deep.equal([[T(2), 20n]]);
    expect(((calls[0].params as { blockchain: string[] }).blockchain).sort()).to.deep.equal(["base", "eth"]);
  });

  it("retries a JSON-RPC rate-limit error", async () => {
    let n = 0;
    const { fn } = fakeFetch(() =>
      n++ === 0
        ? { status: 200, json: { error: { message: "Too many requests, reason: call rate limit exhausted" } } }
        : { status: 200, json: { result: { assets: [] } } },
    );
    const r = await ankrHoldings(ROUTER, ["mainnet"], { ...FAST, ankrKey: "k", fetchFn: fn });
    expect(r.get("mainnet")!.ok).to.equal(true);
  });
});

describe("balanceDiscovery: discoverHoldings", () => {
  const both = (alchemy: Handler, ankr: Handler) =>
    fakeFetch((u, b) => (u.includes("ankr") ? ankr(u, b) : alchemy(u, b)));

  it("unions both providers and keeps the larger balance", async () => {
    const { fn } = both(
      () => ({ status: 200, json: { data: { tokens: [{ tokenAddress: T(1), tokenBalance: hex(5n) }] } } }),
      () => ({
        status: 200,
        json: {
          result: {
            assets: [
              { blockchain: "eth", tokenType: "ERC20", contractAddress: T(1), balanceRawInteger: "9" },
              { blockchain: "eth", tokenType: "ERC20", contractAddress: T(2), balanceRawInteger: "3" },
            ],
          },
        },
      }),
    );
    const r = (await discoverHoldings([{ network: "mainnet", router: ROUTER }], { ...FAST, alchemyKey: "a", ankrKey: "b", fetchFn: fn })).get("mainnet")!;
    expect(r.status).to.equal("covered");
    expect(r.providers).to.deep.equal(["alchemy", "ankr"]);
    expect(r.balances.get(T(1))).to.equal(9n);
    expect(r.balances.get(T(2))).to.equal(3n);
  });

  it("is covered by the survivor when one provider fails, with a warning", async () => {
    const { fn } = both(
      () => ({ status: 503, json: null }),
      () => ({ status: 200, json: { result: { assets: [{ blockchain: "eth", tokenType: "ERC20", contractAddress: T(1), balanceRawInteger: "1" }] } } }),
    );
    const r = (await discoverHoldings([{ network: "mainnet", router: ROUTER }], { ...FAST, alchemyKey: "a", ankrKey: "b", fetchFn: fn })).get("mainnet")!;
    expect(r.status).to.equal("covered");
    expect(r.providers).to.deep.equal(["ankr"]);
    expect(r.warnings.join()).to.match(/alchemy balance API failed/);
  });

  it("is failed when every supporting provider fails, unsupported when none supports it", async () => {
    const { fn } = both(() => ({ status: 503, json: null }), () => ({ status: 503, json: null }));
    const r = await discoverHoldings(
      [
        { network: "mainnet", router: ROUTER },
        { network: "plasma", router: ROUTER },
      ],
      { ...FAST, alchemyKey: "a", ankrKey: "b", fetchFn: fn },
    );
    expect(r.get("mainnet")!.status).to.equal("failed");
    expect(r.get("mainnet")!.balances.size).to.equal(0);
    expect(r.get("plasma")!.status).to.equal("unsupported");
    expect(discoverySupported("plasma")).to.equal(false);
    expect(discoverySupported("hyperevm")).to.equal(true);
  });

  it("with no keys, everything is unsupported and nothing is fetched", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, json: {} }));
    const r = await discoverHoldings([{ network: "base", router: ROUTER }], { alchemyKey: "", ankrKey: "", fetchFn: fn });
    expect(r.get("base")!.status).to.equal("unsupported");
    expect(calls).to.have.length(0);
  });
});

describe("feeDiscovery: selection and judging", () => {
  it("skips listed, excluded, sentinel, and ignored-at-same-or-lower balance; re-evaluates growth", () => {
    const entry = {
      network: "op",
      mode: "auto" as const,
      tokens: [{ address: T(1), symbol: "A", decimals: 18, source: "seed", addedAt: "x" }],
      excluded: [{ address: T(2), reason: "reverts", excludedAt: "x" }],
      ignored: [
        { address: T(3), reason: "spam", balanceRaw: "100", ignoredAt: "x" },
        { address: T(4), reason: "dust", balanceRaw: "100", ignoredAt: "x" },
      ],
    };
    const held = new Map<string, bigint>([
      [T(1), 1n],
      [T(2), 1n],
      [T(3), 100n],
      [T(4), 101n],
      [T(5), 1n],
      [OP_LEGACY_ETH, 1n],
    ]);
    expect([...selectCandidates(10, entry, held).keys()]).to.deep.equal([T(4), T(5)]);
  });

  it("passes only a firm value >= threshold", () => {
    const base: PricedFeeAsset = { token: T(1), symbol: "X", decimals: 18, balance: 1n };
    expect(judge({ ...base, usdValue: 1 }, 1)).to.deep.equal({ pass: true });
    expect(judge({ ...base, usdValue: 0.99 }, 1).pass).to.equal(false);
    expect(judge({ ...base, usdValueThin: 500, priceSource: "gecko:$3k" }, 1)).to.deep.include({ pass: false });
    expect((judge({ ...base, usdValueThin: 500 }, 1) as { reason: string }).reason).to.match(/thin/);
    expect((judge({ ...base, priceSource: "unpriced:no-market" }, 1) as { reason: string }).reason).to.match(/no price/);
  });
});

// ---- applyDiscovery against a scripted chain --------------------------------

const MC = new Interface([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)",
]);
const ERC20 = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
const CODER = AbiCoder.defaultAbiCoder();

function chainFake(tokens: Record<string, { bal: bigint; dec?: number; sym?: string }>): BalanceProbeProvider {
  return {
    getCode: async () => "0x6000",
    call: async (tx: { data?: string }) => {
      const calls = MC.decodeFunctionData("aggregate3", tx.data ?? "0x")[0] as { target: string; callData: string }[];
      const results = calls.map((c) => {
        const t = tokens[getAddress(c.target)];
        if (!t) return { success: false, returnData: "0x" };
        const sel = c.callData.slice(0, 10);
        if (sel === ERC20.getFunction("balanceOf")!.selector) return { success: true, returnData: CODER.encode(["uint256"], [t.bal]) };
        if (sel === ERC20.getFunction("decimals")!.selector) {
          return t.dec === undefined ? { success: false, returnData: "0x" } : { success: true, returnData: CODER.encode(["uint8"], [t.dec]) };
        }
        return { success: true, returnData: CODER.encode(["string"], [t.sym ?? "?"]) };
      });
      return MC.encodeFunctionResult("aggregate3", [results]);
    },
  } as unknown as BalanceProbeProvider;
}

const CHAIN: SafeChain = { network: "base", chainId: 8453, rpcUrl: "http://unused", router: ROUTER, netCfg: {} };

describe("feeDiscovery: applyDiscovery", () => {
  function file(): FeeTokensFile {
    const f = emptyFeeTokens();
    f.chains["8453"] = {
      network: "base",
      mode: "auto",
      tokens: [{ address: T(1), symbol: "USDC", decimals: 6, source: "seed", addedAt: "x" }],
    };
    return f;
  }
  const covered = (bal: [string, bigint][]) => ({
    network: "base",
    status: "covered" as const,
    providers: ["alchemy" as const],
    balances: new Map(bal),
    warnings: [],
  });
  // $ value = balance units in this stub; a token named SPAM gets no price, THIN gets a thin one.
  const price = (async (_p: unknown, _c: unknown, assets: PricedFeeAsset[]) => ({
    priced: assets.map((a) =>
      a.symbol === "SPAM"
        ? { ...a, priceSource: "unpriced:no-market" }
        : a.symbol === "THIN"
          ? { ...a, usdValueThin: 50, priceTier: "thin" as const, priceSource: "gecko:$300" }
          : { ...a, usdValue: Number(a.balance), priceTier: "firm" as const, priceSource: "llama:0.99" },
    ),
    nativeUsd: null,
    warnings: [],
  })) as never;

  it("adds firm >= $1 tokens that pass the vet; ignores the rest with their balance", async () => {
    const f = file();
    const vetted: string[][] = [];
    const vet = (async (_c: SafeChain, entry: FeeTokensFile["chains"][string], cands: Map<string, Set<string>>): Promise<VetResult> => {
      vetted.push([...cands.keys()]);
      const added = [...cands.keys()].map((a) => ({ address: a, symbol: "GOOD", decimals: 18, source: "balance-api", addedAt: "now" }));
      entry.tokens.push(...added);
      return { network: "base", chainId: 8453, added, excluded: [], total: entry.tokens.length, fullGas: 1n };
    }) as never;
    const out = await applyDiscovery(
      CHAIN,
      f,
      covered([
        [T(1), 1n], // already listed
        [T(2), 5n], // GOOD, $5
        [T(3), 1000n], // SPAM, no price
        [T(4), 1n], // DUST, firm $1 < $2 threshold
        [T(5), 9n], // THIN
        [T(6), 3n], // API says 3, chain says 0 -> stale, skipped silently
        [T(7), 2n], // no decimals
      ]),
      {
        safe: SAFE,
        minUsd: 2,
        price,
        vet,
        provider: chainFake({
          [T(2)]: { bal: 5n, dec: 18, sym: "GOOD" },
          [T(3)]: { bal: 1000n, dec: 18, sym: "SPAM" },
          [T(4)]: { bal: 1n, dec: 18, sym: "DUST" },
          [T(5)]: { bal: 9n, dec: 18, sym: "THIN" },
          [T(6)]: { bal: 0n, dec: 18, sym: "GONE" },
          [T(7)]: { bal: 2n, sym: "NODEC" },
        }),
      },
    );
    expect(out.error).to.equal(undefined);
    expect(out.evaluated).to.equal(6);
    expect(vetted).to.deep.equal([[T(2)]]);
    expect(out.added.map((a) => [a.token, a.usdValue])).to.deep.equal([[T(2), 5]]);
    const ign = new Map(f.chains["8453"].ignored!.map((i) => [i.address, i]));
    expect([...ign.keys()].sort()).to.deep.equal([T(3), T(4), T(5), T(7)].sort());
    expect(ign.get(T(3))!.balanceRaw).to.equal("1000");
    expect(ign.get(T(3))!.reason).to.match(/no price/);
    expect(ign.get(T(4))!.reason).to.match(/firm \$1\.0000 < \$2/);
    expect(ign.get(T(5))!.reason).to.match(/thin/);
    expect(ign.get(T(7))!.reason).to.match(/decimals/);
    expect(ign.has(T(6))).to.equal(false);
    // round-trips through the schema validator
    parseFeeTokens(JSON.parse(JSON.stringify(f)));
  });

  it("an ignored token is evaluated again only once its balance grows", async () => {
    const f = file();
    f.chains["8453"].ignored = [{ address: T(3), symbol: "X", reason: "dust", balanceRaw: "1", ignoredAt: "x" }];
    let vetCalls = 0;
    const vet = (async (_c: SafeChain, entry: FeeTokensFile["chains"][string], cands: Map<string, Set<string>>) => {
      vetCalls++;
      const added = [...cands.keys()].map((a) => ({ address: a, symbol: "X", decimals: 18, source: "balance-api", addedAt: "now" }));
      entry.tokens.push(...added);
      entry.ignored = entry.ignored?.filter((i) => !cands.has(i.address));
      return { network: "base", chainId: 8453, added, excluded: [], total: 0, fullGas: 1n };
    }) as never;
    const provider = chainFake({ [T(3)]: { bal: 50n, dec: 18, sym: "X" } });
    const same = await applyDiscovery(CHAIN, f, covered([[T(3), 1n]]), { safe: SAFE, price, vet, provider });
    expect(same.evaluated).to.equal(0);
    expect(vetCalls).to.equal(0);
    const grown = await applyDiscovery(CHAIN, f, covered([[T(3), 50n]]), { safe: SAFE, price, vet, provider });
    expect(grown.added.map((a) => a.token)).to.deep.equal([T(3)]);
    expect(f.chains["8453"].tokens.map((t) => t.address)).to.include(T(3));
  });

  it("does nothing for an uncovered chain, and reports a vet failure without adding", async () => {
    const f = file();
    const none = await applyDiscovery(CHAIN, f, undefined, { safe: SAFE });
    expect(none.status).to.equal("unsupported");
    expect(none.source).to.equal("none");
    const failedVet = (async () => ({ network: "base", chainId: 8453, added: [], excluded: [], total: 1, fullGas: null, error: "3 candidate(s) could not be checked" })) as never;
    const r = await applyDiscovery(CHAIN, f, covered([[T(2), 5n]]), {
      safe: SAFE,
      price,
      vet: failedVet,
      provider: chainFake({ [T(2)]: { bal: 5n, dec: 18, sym: "GOOD" } }),
    });
    expect(r.added).to.have.length(0);
    expect(r.error).to.match(/vet failed/);
    expect(f.chains["8453"].tokens).to.have.length(1);
  });

  it("an unreadable on-chain probe is an error, not an empty result", async () => {
    const f = file();
    const broken = { getCode: async () => "0x6000", call: async () => { throw new Error("down"); } } as unknown as BalanceProbeProvider;
    const r = await applyDiscovery(CHAIN, f, covered([[T(2), 5n]]), { safe: SAFE, price, provider: broken });
    expect(r.error).to.match(/could not be read on chain/);
    expect(f.chains["8453"].ignored).to.equal(undefined);
  });
});

describe("feeTokens: ignored schema", () => {
  it("rejects a token that is both listed and ignored, and bad balances", () => {
    const f = emptyFeeTokens();
    f.chains["10"] = {
      network: "op",
      mode: "auto",
      tokens: [{ address: T(1), symbol: "A", decimals: 18, source: "x", addedAt: "x" }],
      ignored: [{ address: T(1), reason: "r", balanceRaw: "1", ignoredAt: "x" }],
    };
    expect(() => parseFeeTokens(JSON.parse(JSON.stringify(f)))).to.throw(/both a token and ignored/);
    f.chains["10"].ignored = [{ address: T(2), reason: "r", balanceRaw: "1.5", ignoredAt: "x" }];
    expect(() => parseFeeTokens(JSON.parse(JSON.stringify(f)))).to.throw(/non-integer balanceRaw/);
  });
});
