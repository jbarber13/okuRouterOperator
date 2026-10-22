/**
 * fees:tokens / fees:audit
 *
 * Maintain data/fee-tokens.json, the curated per-chain list sweeps are built
 * from (see util/feeTokens.ts for why it replaced discovery).
 *
 *   fees:tokens --bootstrap   build/extend the list from every source we have:
 *                               - data/known-fee-assets.json (OrderFilled seed)
 *                               - chain-config tokens
 *                               - every asset ever swept (fee-reports/data)
 *                               - tokens on the published Oku list that hold a
 *                                 balance on the router right now
 *   fees:tokens               print the list (counts, mode) per chain
 *   fees:audit [--write]      probe the published list for balances the curated
 *                             list misses; --write adds them after vetting.
 *
 * Every candidate is VETTED before it can enter the list:
 *   1. balanceOf(router) must return a full word (has code, is an ERC20);
 *   2. sweepAll(whole list) simulated from the Safe must succeed. A revert is
 *      bisected to the offending token(s), which are recorded under `excluded`
 *      with the revert reason rather than silently dropped.
 *
 * Nothing here signs or sends anything.
 */
import * as fs from "fs";
import * as path from "path";
import { task } from "hardhat/config";
import { formatUnits } from "ethers";
import { listSafeChains, makeProvider, mapLimit, pad, type SafeChain } from "../util/safeChains";
import { NETWORK_CONFIGS } from "../util/deploymentConfig";
import { getOkuSafeDeployment, OKU_FEE_RECIPIENT } from "../util/safeConfig";
import { multicallAddressFor, probeBalances, probeMetadata } from "../util/balanceProbe";
import type { BalanceProbeProvider } from "../util/balanceProbe";
import {
  _internal as universeInternal,
  buildTokenUniverse,
  chainConfigTokens,
  indexByChain,
  loadKnownFeeAssets,
  loadOkuTokenList,
} from "../util/tokenUniverse";
import {
  DEFAULT_MODE_OVERRIDES,
  FEE_TOKENS_FILE,
  bisectFailures,
  emptyFeeTokens,
  loadFeeTokens,
  saveFeeTokens,
  sortTokens,
  type FeeTokenChain,
  type FeeTokenEntry,
  type FeeTokensFile,
} from "../util/feeTokens";
import { estimateSweepGas, simulateSweep, sweepGasCap } from "../util/sweepCall";
import { toChecksum } from "../util/address";

const REPORTS_DATA = path.resolve(__dirname, "..", "fee-reports", "data");

/** chainId -> addresses that have actually been swept, from accounting records. */
function sweptHistory(): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  if (!fs.existsSync(REPORTS_DATA)) return out;
  for (const day of fs.readdirSync(REPORTS_DATA)) {
    const dir = path.join(REPORTS_DATA, day);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const id = Number(r.chainId);
        if (!Number.isInteger(id)) continue;
        if (!out.has(id)) out.set(id, new Set());
        for (const a of r.assets ?? []) {
          const t = toChecksum(a.token);
          if (t) out.get(id)!.add(t);
        }
      } catch {
        /* unreadable record: skip */
      }
    }
  }
  return out;
}

interface ChainResult {
  network: string;
  chainId: number;
  added: FeeTokenEntry[];
  excluded: { address: string; symbol?: string; reason: string }[];
  total: number;
  fullGas: bigint | null;
  error?: string;
}

/**
 * Vet `candidates` (address -> provenance) against one chain and merge the
 * survivors into `entry`. Existing entries are re-vetted too: a token that
 * started reverting since the last run must come out, loudly.
 */
async function vetChain(
  chain: SafeChain,
  entry: FeeTokenChain,
  candidates: Map<string, Set<string>>,
  safe: string,
): Promise<ChainResult> {
  const res: ChainResult = {
    network: chain.network,
    chainId: chain.chainId,
    added: [],
    excluded: [],
    total: 0,
    fullGas: null,
  };
  const cfg = NETWORK_CONFIGS[chain.network];
  const provider = makeProvider(chain.rpcUrl, chain.chainId);
  const now = new Date().toISOString();
  try {
    const existing = new Map(entry.tokens.map((t) => [t.address, t]));
    const previouslyExcluded = new Set((entry.excluded ?? []).map((e) => e.address));
    const fresh = [...candidates.keys()].filter(
      (a) => !existing.has(a) && !previouslyExcluded.has(a),
    );
    const all = [...existing.keys(), ...fresh];

    // 1. balanceOf must answer with a word.
    const probe = await probeBalances(provider as unknown as BalanceProbeProvider, chain.router!, all, {
      multicall: multicallAddressFor(cfg),
    });
    if (!probe.available) throw new Error(probe.warnings.join("; ") || "multicall unavailable");
    if (probe.unchecked > 0) {
      throw new Error(`${probe.unchecked} candidate(s) could not be checked; re-run with a better RPC`);
    }
    const responding = all.filter((a) => probe.responding.has(a));
    for (const a of all) {
      if (!probe.responding.has(a)) {
        res.excluded.push({ address: a, reason: "balanceOf(router) did not return a word (no code / not ERC20)" });
      }
    }

    // 2. the whole list must sweep. Bisect any revert to the culprits.
    const to = OKU_FEE_RECIPIENT;
    const bad = await bisectFailures(responding, async (subset) =>
      (await simulateSweep(provider, safe, chain.router!, subset, false, to)).ok,
    );
    for (const a of bad) {
      const sim = await simulateSweep(provider, safe, chain.router!, [a], false, to);
      res.excluded.push({ address: a, reason: `sweepAll([token]) reverts: ${sim.reason ?? "unknown"}` });
    }
    const badSet = new Set(bad);
    const keep = responding.filter((a) => !badSet.has(a));

    const { meta } = await probeMetadata(provider as unknown as BalanceProbeProvider, keep, {
      multicall: multicallAddressFor(cfg),
    });
    const tokens: FeeTokenEntry[] = keep.map((a) => {
      const prev = existing.get(a);
      const m = meta.get(a);
      const srcs = new Set([...(prev?.source ? prev.source.split(",") : []), ...(candidates.get(a) ?? [])]);
      const t: FeeTokenEntry = {
        address: a,
        symbol: m?.symbol ?? prev?.symbol ?? "?",
        decimals: m?.decimals ?? prev?.decimals ?? null,
        source: [...srcs].sort().join(","),
        addedAt: prev?.addedAt ?? now,
        ...(prev?.priceAs ? { priceAs: prev.priceAs } : {}),
      };
      if (!prev) res.added.push(t);
      return t;
    });

    const symOf = new Map(tokens.map((t) => [t.address, t.symbol]));
    entry.tokens = sortTokens(tokens);
    const excl = new Map((entry.excluded ?? []).map((e) => [e.address, e]));
    for (const e of res.excluded) {
      excl.set(e.address, { address: e.address, symbol: symOf.get(e.address), reason: e.reason, excludedAt: now });
    }
    entry.excluded = [...excl.values()];
    res.total = entry.tokens.length;
    res.fullGas = await estimateSweepGas(
      provider,
      safe,
      chain.router!,
      entry.tokens.map((t) => t.address),
      true,
      to,
    );
    const cap = await sweepGasCap(provider);
    if (res.fullGas !== null && res.fullGas > cap) {
      res.error = `full-list sweep estimates ${res.fullGas} gas > cap ${cap}; this chain must run nonzero`;
    }
  } catch (e) {
    res.error = String((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? e).slice(0, 200);
  } finally {
    provider.destroy();
  }
  return res;
}

function report(results: ChainResult[]): void {
  console.log(
    `\n  ${pad("chain", 12)}${pad("tokens", 8)}${pad("added", 7)}${pad("excluded", 10)}full-list gas`,
  );
  for (const r of results) {
    console.log(
      `  ${pad(r.network, 12)}${pad(String(r.total), 8)}${pad(String(r.added.length), 7)}` +
        `${pad(String(r.excluded.length), 10)}${r.fullGas ?? "?"}${r.error ? `   ✗ ${r.error}` : ""}`,
    );
  }
  for (const r of results) {
    for (const e of r.excluded) console.log(`  ! ${r.network}: excluded ${e.address}  ${e.reason}`);
  }
}

function selectChains(hre: Parameters<typeof listSafeChains>[0], networks?: string): SafeChain[] {
  const only = networks
    ? new Set(String(networks).split(",").map((s) => s.trim()).filter(Boolean))
    : undefined;
  return listSafeChains(hre, only).filter((c) => c.router && c.rpcUrl);
}

task("fees:tokens", "Show or bootstrap data/fee-tokens.json (the curated sweep list)")
  .addOptionalParam("networks", "Comma-separated network names (default: all deployed)")
  .addFlag("bootstrap", "Build/extend the list from seed + chain-config + swept history + live list balances")
  .addFlag("skipTokenlist", "With --bootstrap: do not probe the published Oku list")
  .setAction(async (args, hre) => {
    if (!args.bootstrap) {
      const f = loadFeeTokens();
      console.log(`\n${path.relative(process.cwd(), FEE_TOKENS_FILE)}  fullSweepMaxUsd=$${f.fullSweepMaxUsd}`);
      for (const [id, c] of Object.entries(f.chains)) {
        console.log(
          `  ${pad(c.network, 12)}${pad(id, 10)}${pad(c.mode, 9)}${pad(`${c.tokens.length} tokens`, 12)}` +
            `${c.excluded?.length ? `${c.excluded.length} excluded` : ""}`,
        );
      }
      return;
    }

    const safe = getOkuSafeDeployment().address;
    const chains = selectChains(hre, args.networks);
    const file: FeeTokensFile = fs.existsSync(FEE_TOKENS_FILE) ? loadFeeTokens() : emptyFeeTokens();
    const seed = loadKnownFeeAssets();
    const history = sweptHistory();
    let listByChain = new Map<number, Set<string>>();
    if (!args.skipTokenlist) {
      const list = await loadOkuTokenList({ strict: true });
      listByChain = indexByChain(list.tokens);
      console.log(`Published list: ${list.tokens.length} entries (${list.fromCache ? "cached" : "fetched"})`);
    }

    const results = await mapLimit(chains, 4, async (chain) => {
      const cfg = NETWORK_CONFIGS[chain.network];
      const cands = new Map<string, Set<string>>();
      const add = (a: string, src: string) => {
        if (universeInternal.NOT_A_TOKEN.has(a)) return;
        if (universeInternal.UNSWEEPABLE[chain.chainId]?.[a]) return;
        if (!cands.has(a)) cands.set(a, new Set());
        cands.get(a)!.add(src);
      };
      for (const a of seed.get(chain.chainId) ?? []) add(a, "seed");
      for (const a of chainConfigTokens(cfg)) add(a, "chain-config");
      for (const a of history.get(chain.chainId) ?? []) add(a, "swept");
      if (listByChain.size) {
        // Only list tokens the router holds RIGHT NOW: the other ~40k are
        // tokens nobody has paid a fee in, and would just be calldata.
        const uni = buildTokenUniverse(chain, listByChain, cfg);
        const provider = makeProvider(chain.rpcUrl, chain.chainId);
        try {
          const p = await probeBalances(provider as unknown as BalanceProbeProvider, chain.router!, uni.tokens, {
            multicall: multicallAddressFor(cfg),
          });
          for (const a of p.balances.keys()) add(a, "tokenlist-balance");
        } finally {
          provider.destroy();
        }
      }
      const key = String(chain.chainId);
      const entry: FeeTokenChain = file.chains[key] ?? {
        network: chain.network,
        mode: DEFAULT_MODE_OVERRIDES[chain.chainId] ?? "auto",
        tokens: [],
      };
      const r = await vetChain(chain, entry, cands, safe);
      if (!r.error || r.total > 0) file.chains[key] = entry;
      console.log(`  ${pad(chain.network, 12)} ${r.total} tokens${r.error ? `  ✗ ${r.error}` : ""}`);
      return r;
    });

    report(results);
    saveFeeTokens(file);
    console.log(`\nWritten: ${path.relative(process.cwd(), FEE_TOKENS_FILE)}  -- review the diff, then commit.`);
    if (results.some((r) => r.error)) process.exitCode = 1;
  });

task("fees:audit", "Find router balances in tokens the curated list does not cover")
  .addOptionalParam("networks", "Comma-separated network names (default: all deployed)")
  .addFlag("write", "Vet and add the missing tokens to data/fee-tokens.json")
  .setAction(async (args, hre) => {
    const safe = getOkuSafeDeployment().address;
    const chains = selectChains(hre, args.networks);
    const file = loadFeeTokens();
    const list = await loadOkuTokenList({ strict: true });
    const listByChain = indexByChain(list.tokens);
    let missingTotal = 0;

    const results = await mapLimit(chains, 4, async (chain) => {
      const cfg = NETWORK_CONFIGS[chain.network];
      const key = String(chain.chainId);
      const entry = file.chains[key];
      const listed = new Set((entry?.tokens ?? []).map((t) => t.address));
      const excluded = new Set((entry?.excluded ?? []).map((t) => t.address));
      const uni = buildTokenUniverse(chain, listByChain, cfg);
      const provider = makeProvider(chain.rpcUrl, chain.chainId);
      const missing: { address: string; balance: bigint }[] = [];
      let unchecked = 0;
      try {
        const p = await probeBalances(provider as unknown as BalanceProbeProvider, chain.router!, uni.tokens, {
          multicall: multicallAddressFor(cfg),
        });
        unchecked = p.unchecked;
        for (const [a, bal] of p.balances) if (!listed.has(a) && !excluded.has(a)) missing.push({ address: a, balance: bal });
        if (missing.length) {
          const { meta } = await probeMetadata(provider as unknown as BalanceProbeProvider, missing.map((m) => m.address), {
            multicall: multicallAddressFor(cfg),
          });
          for (const m of missing) {
            const md = meta.get(m.address);
            console.log(
              `  ${pad(chain.network, 12)} MISSING ${m.address}  ${md?.symbol ?? "?"}  ` +
                `${md ? formatUnits(m.balance, md.decimals) : m.balance.toString() + " raw"}`,
            );
          }
        }
      } finally {
        provider.destroy();
      }
      missingTotal += missing.length;
      if (unchecked) console.log(`  ${pad(chain.network, 12)} ! ${unchecked} candidate(s) unchecked`);
      if (!args.write || missing.length === 0) return null;
      const e: FeeTokenChain = entry ?? {
        network: chain.network,
        mode: DEFAULT_MODE_OVERRIDES[chain.chainId] ?? "auto",
        tokens: [],
      };
      const r = await vetChain(chain, e, new Map(missing.map((m) => [m.address, new Set(["audit"])])), safe);
      file.chains[key] = e;
      return r;
    });

    console.log(`\n${missingTotal} held token(s) not on the curated list.`);
    if (args.write) {
      const done = results.filter((r): r is ChainResult => r !== null);
      if (done.length) {
        report(done);
        saveFeeTokens(file);
        console.log(`\nWritten: ${path.relative(process.cwd(), FEE_TOKENS_FILE)}  -- review the diff, then commit.`);
      }
    } else if (missingTotal) {
      console.log("Re-run with --write to vet and add them.");
      process.exitCode = 1;
    }
  });
