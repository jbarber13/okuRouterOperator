/**
 * dryRunDiscovery.ts
 *
 * Read-only measurement of what a Multicall3 balance probe would find, and
 * what DefiLlama would price, compared against what `eth_getLogs` discovery
 * has actually found so far.
 *
 * This writes NOTHING except the shared token-list cache (gitignored derived
 * state). It does not touch .cache/fee-assets, does not produce a snapshot,
 * and cannot be mistaken for a collection record.
 *
 * Usage:
 *   npx hardhat run scripts/dryRunDiscovery.ts
 *
 * Env:
 *   DRYRUN_ONLY     comma-separated network names to limit the run
 *   DRYRUN_NO_PRICE set to skip DefiLlama entirely
 *
 * The three columns that matter:
 *
 *   NEW      non-zero balances the probe found that log discovery has never
 *            seen. This is what the probe adds.
 *   LOGSONLY non-zero balances held in tokens that appear in NO published
 *            list. Only `eth_getLogs` can ever find these, which is why the
 *            probe is a union member and not a replacement.
 *   UNCHK    candidates the probe could not check. Not evidence of zero.
 */
import hre from "hardhat";
import { formatUnits } from "ethers";
import { listSafeChains, makeProvider, mapLimit } from "../util/safeChains";
import { NETWORK_CONFIGS } from "../util/deploymentConfig";
import { readCache } from "../util/feeAssetCache";
import { toChecksum } from "../util/feeScan";
import { buildTokenUniverse, indexByChain, loadOkuTokenList } from "../util/tokenUniverse";
import { multicallAddressFor, probeBalances } from "../util/balanceProbe";
import { fetchLlamaPrices, llamaSlug } from "../util/priceLlama";

interface Row {
  network: string;
  chainId: number;
  status: string;
  cacheTokens: number;
  listed: number;
  universe: number;
  calls: number;
  found: number;
  fresh: number;
  logsOnly: number;
  unchecked: number;
  usd: number | null;
  pricedOf: string;
  warnings: string[];
}

async function main(): Promise<void> {
  const only = process.env.DRYRUN_ONLY?.trim()
    ? new Set(process.env.DRYRUN_ONLY.split(",").map((s) => s.trim()))
    : undefined;
  const doPrice = !process.env.DRYRUN_NO_PRICE;

  const chains = listSafeChains(hre, only);
  console.log(`Dry run over ${chains.length} chain(s). Read-only; no cache or snapshot is written.\n`);

  const list = await loadOkuTokenList();
  for (const w of list.warnings) console.log(`  ! ${w}`);
  const byChain = indexByChain(list.tokens);
  console.log(
    `Token list: ${list.tokens.length} entries across ${byChain.size} chains ` +
      `(${list.fromCache ? "cached" : "fetched"})\n`,
  );

  const rows = await mapLimit(chains, 4, async (chain): Promise<Row> => {
    const cfg = NETWORK_CONFIGS[chain.network];
    const cached = readCache(chain.network);
    const listed = byChain.get(chain.chainId) ?? new Set<string>();
    const universe = buildTokenUniverse(chain, byChain, cfg);

    const base: Row = {
      network: chain.network,
      chainId: chain.chainId,
      status: "ok",
      cacheTokens: cached?.tokens.length ?? 0,
      listed: listed.size,
      universe: universe.tokens.size,
      calls: 0,
      found: 0,
      fresh: 0,
      logsOnly: 0,
      unchecked: 0,
      usd: null,
      pricedOf: "",
      warnings: [...universe.warnings],
    };

    const rpc = chain.rpcUrl || chain.logsRpcUrl;
    if (!rpc) return { ...base, status: "no-rpc" };
    if (!chain.router) return { ...base, status: "no-router" };

    const provider = makeProvider(rpc, chain.chainId);
    try {
      const probe = await probeBalances(provider, chain.router, universe.tokens, {
        multicall: multicallAddressFor(cfg),
      });
      base.calls = probe.calls;
      base.unchecked = probe.unchecked;
      base.warnings.push(...probe.warnings);
      if (!probe.available) return { ...base, status: "no-multicall" };

      const knownFromLogs = new Set<string>();
      for (const t of cached?.tokens ?? []) {
        const a = toChecksum(t);
        if (a) knownFromLogs.add(a);
      }

      base.found = probe.balances.size;
      for (const token of probe.balances.keys()) {
        if (!knownFromLogs.has(token)) base.fresh++;
        if (!listed.has(token)) base.logsOnly++;
      }

      if (doPrice && probe.balances.size > 0 && llamaSlug(chain.network)) {
        const px = await fetchLlamaPrices(chain.network, probe.balances.keys());
        base.warnings.push(...px.warnings);
        let usd = 0;
        let priced = 0;
        for (const [token, bal] of probe.balances) {
          const p = px.prices.get(token);
          if (!p || p.decimals === undefined) continue;
          usd += Number(formatUnits(bal, p.decimals)) * p.price;
          priced++;
        }
        base.usd = usd;
        base.pricedOf = `${priced}/${probe.balances.size}`;
      }
      return base;
    } catch (e) {
      base.warnings.push(String((e as Error).message ?? e).slice(0, 140));
      return { ...base, status: "error" };
    } finally {
      provider.destroy();
    }
  });

  rows.sort((a, b) => a.chainId - b.chainId);

  const p = (v: unknown, n: number) => String(v ?? "").padStart(n);
  const l = (v: unknown, n: number) => String(v ?? "").padEnd(n);

  console.log(
    `${l("network", 12)} ${p("cache", 6)} ${p("listed", 7)} ${p("univ", 7)} ${p("calls", 6)} ` +
      `${p("FOUND", 6)} ${p("NEW", 5)} ${p("LOGSONLY", 9)} ${p("UNCHK", 6)} ${p("USD", 11)}  priced  status`,
  );
  console.log("-".repeat(118));

  let tFound = 0;
  let tFresh = 0;
  let tLogsOnly = 0;
  let tCalls = 0;
  let tUsd = 0;
  let tUnchecked = 0;
  for (const r of rows) {
    tFound += r.found;
    tFresh += r.fresh;
    tLogsOnly += r.logsOnly;
    tCalls += r.calls;
    tUnchecked += r.unchecked;
    tUsd += r.usd ?? 0;
    console.log(
      `${l(r.network, 12)} ${p(r.cacheTokens, 6)} ${p(r.listed, 7)} ${p(r.universe, 7)} ${p(r.calls, 6)} ` +
        `${p(r.found, 6)} ${p(r.fresh, 5)} ${p(r.logsOnly, 9)} ${p(r.unchecked, 6)} ` +
        `${p(r.usd === null ? "-" : `$${r.usd.toFixed(2)}`, 11)}  ${l(r.pricedOf, 7)} ${r.status}`,
    );
  }

  console.log("-".repeat(118));
  console.log(
    `${l("TOTAL", 12)} ${p("", 6)} ${p("", 7)} ${p("", 7)} ${p(tCalls, 6)} ` +
      `${p(tFound, 6)} ${p(tFresh, 5)} ${p(tLogsOnly, 9)} ${p(tUnchecked, 6)} ${p(`$${tUsd.toFixed(2)}`, 11)}`,
  );

  console.log("");
  console.log(`Total eth_calls for the whole probe : ${tCalls}`);
  console.log(`Non-zero balances found             : ${tFound}`);
  console.log(`  ...never seen by log discovery    : ${tFresh}   <- what the probe adds`);
  console.log(`  ...in no published token list     : ${tLogsOnly}   <- why getLogs must stay`);
  if (tUnchecked > 0) {
    console.log(`Candidates NOT checked              : ${tUnchecked}   <- not evidence of zero`);
  }

  const noisy = rows.filter((r) => r.warnings.length > 0);
  if (noisy.length) {
    console.log("\nWarnings:");
    for (const r of noisy) {
      for (const w of r.warnings) console.log(`  ${r.network}: ${w}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
