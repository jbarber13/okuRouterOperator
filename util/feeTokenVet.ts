/**
 * feeTokenVet.ts
 *
 * The gate every token passes before it can enter data/fee-tokens.json,
 * shared by `fees:tokens --bootstrap`, `fees:audit --write` and the
 * balance-API discovery step of `fees:cycle`:
 *
 *   1. balanceOf(router) must return a full word (has code, is an ERC20);
 *   2. sweepAll(whole list) simulated from the Safe must succeed. A revert is
 *      bisected to the offending token(s), which are recorded under `excluded`
 *      with the revert reason rather than silently dropped.
 *
 * Existing entries are re-vetted too: a token that started reverting since
 * the last run must come out, loudly. Nothing here signs or sends anything.
 */
import { makeProvider, type SafeChain } from "./safeChains";
import { NETWORK_CONFIGS } from "./deploymentConfig";
import { OKU_FEE_RECIPIENT } from "./safeConfig";
import { multicallAddressFor, probeBalances, probeMetadata } from "./balanceProbe";
import type { BalanceProbeProvider } from "./balanceProbe";
import { bisectFailures, sortTokens, type FeeTokenChain, type FeeTokenEntry } from "./feeTokens";
import { estimateSweepGas, simulateSweep, sweepGasCap } from "./sweepCall";

export interface VetResult {
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
 * survivors into `entry` (mutated in place).
 */
export async function vetChain(
  chain: SafeChain,
  entry: FeeTokenChain,
  candidates: Map<string, Set<string>>,
  safe: string,
): Promise<VetResult> {
  const res: VetResult = {
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
    // A token cannot be both swept and ignored.
    if (entry.ignored?.length) {
      const listed = new Set(entry.tokens.map((t) => t.address));
      entry.ignored = entry.ignored.filter((i) => !listed.has(i.address) && !excl.has(i.address));
    }
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
