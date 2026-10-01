/**
 * fees:scan
 *
 * Read-only report of idle protocol fees sitting on the OkuRouter of each
 * chain. Sends no transactions and needs no key.
 *
 * This exists because the router has no fee accounting of any kind: there is
 * no `collectableFees()` view, no per-token mapping, nothing. Fees are simply
 * the contract's own balance, so the only way to know what is there is to ask
 * a candidate set of tokens for their balance. See util/tokenUniverse.ts for
 * where the candidates come from and util/balanceProbe.ts for how they are
 * read.
 *
 * ONE total is printed: notional, price x balance, from DefiLlama. There is
 * no realizable figure -- valuation no longer reads pool depth, so nothing
 * here knows whether an asset can actually be sold. Assets with no quote are
 * reported unpriced and contribute $0, and the count is always stated: a
 * "$0.00" meaning "we could not value this" must stay distinguishable from
 * one meaning "there is nothing here".
 *
 * For the full collect-and-sign workflow use `fees:cycle`, which wraps this
 * scan, writes a snapshot, and builds the sweep bundle from it.
 *
 * Usage:
 *   npx hardhat fees:scan
 *   npx hardhat fees:scan --networks worldchain
 *   npx hardhat fees:scan --networks worldchain --json out.json
 *   npx hardhat fees:scan --networks mainnet,op --no-price
 */
import * as fs from "fs";
import { task } from "hardhat/config";
import { listSafeChains, mapLimit, pad } from "../util/safeChains";
import { NATIVE_SENTINEL } from "../util/feeScan";
import { scanChainForSnapshot } from "../util/feeSweepScan";
import { buildSnapshot } from "../util/feeSnapshot";
import { indexByChain, loadOkuTokenList } from "../util/tokenUniverse";

function usd(n: number | undefined): string {
  if (n === undefined) return "     -";
  return `$${n.toFixed(2)}`;
}

task("fees:scan", "Report idle protocol fees held by each OkuRouter")
  .addOptionalParam("networks", "Comma-separated hardhat network names")
  .addOptionalParam("json", "Write the full result to this path as JSON")
  .addOptionalParam(
    "rpc",
    "Override RPC URL (requires a single --networks entry). For multi-chain runs " +
      "set <NET>_URL per chain.",
  )
  .addFlag("noPrice", "Skip USD valuation (much faster)")
  .setAction(async (args, hre) => {
    const only = args.networks
      ? new Set(String(args.networks).split(",").map((s: string) => s.trim()))
      : undefined;
    const chains = listSafeChains(hre, only).filter((c) => c.router);

    if (args.rpc && chains.length !== 1) {
      throw new Error(
        `--rpc applies to one chain, but ${chains.length} were selected. ` +
          `Pass --networks <single network> alongside --rpc for a multi-chain run.`,
      );
    }

    if (chains.length === 0) {
      console.log("No chains matched (or none have an OkuRouter in deployments/).");
      return;
    }

    console.log(`\nScanning idle fees on ${chains.length} chain(s)...\n`);

    // Loaded once and shared across chains: the published list is ~8 MB, so
    // parsing it per chain would cost more than the probe it feeds.
    const list = await loadOkuTokenList();
    for (const w of list.warnings) console.log(`  ! ${w}`);
    const tokenListByChain = indexByChain(list.tokens);
    console.log(
      `Candidate token list: ${list.tokens.length} entries ` +
        `(${list.fromCache ? "cached" : "fetched"})\n`,
    );

    const results = await mapLimit(chains, 4, (chain) =>
      scanChainForSnapshot(chain, {
        price: !args.noPrice,
        tokenListByChain,
        rpcOverride: args.rpc ? String(args.rpc) : undefined,
      }),
    );

    for (const r of results) {
      if (r.status === "error" || r.status === "no-rpc" || r.status === "no-config") {
        console.log(
          `=== ${r.network} (${r.chainId})  --  ${r.status.toUpperCase()}` +
            `${r.error ? `: ${r.error}` : ""}`,
        );
        continue;
      }

      const unp = r.totals.unpricedCount
        ? `  (${r.totals.unpricedCount} unpriced)`
        : "";
      console.log(
        `=== ${r.network} (${r.chainId})  router ${r.router}  ` +
          `${r.totals.assetCount} asset(s)  notional ${usd(r.totals.usdNotional)}${unp}`,
      );
      if (r.probe) {
        const s = r.probe.sources;
        console.log(
          `    probe: ${r.probe.calls} eth_call(s) over ${r.probe.candidates} candidate(s) ` +
            `(list ${s.tokenList}, seed ${s.seed}, config ${s.chainConfig})` +
            `${r.probe.unchecked ? `, ${r.probe.unchecked} UNCHECKED` : ""}`,
        );
      }
      if (r.assets.length) {
        console.log(
          `    ${pad("symbol", 12)}${pad("amount", 26)}${pad("usd", 12)}price source`,
        );
      }
      for (const a of r.assets) {
        console.log(
          `    ${pad(a.symbol.slice(0, 11), 12)}${pad(a.amount, 26)}` +
            `${pad(usd(a.usdValue), 12)}${pad(a.priceSource ?? "-", 22)}` +
            `${a.token === NATIVE_SENTINEL ? "(native)" : a.token}`,
        );
      }
      for (const w of r.warnings) console.log(`    ! ${w}`);
      console.log("");
    }

    const snap = buildSnapshot(results);

    console.log("-".repeat(92));
    const totalAssets = results.reduce((s, r) => s + r.totals.assetCount, 0);
    const pricedAssets = totalAssets - snap.totals.unpricedCount;
    const pct = totalAssets ? ((100 * pricedAssets) / totalAssets).toFixed(1) : "0.0";
    console.log(
      `TOTAL across ${snap.totals.chainsScanned} chain(s):  ` +
        `notional ${usd(snap.totals.usdNotional)}`,
    );
    console.log(
      `Price coverage: ${pricedAssets}/${totalAssets} asset(s) priced (${pct}%)`,
    );
    if (snap.totals.unpricedCount > 0) {
      // Without this line the total above reads as a valuation. It is not: an
      // asset nobody could price contributes $0, which is indistinguishable
      // from an asset that is genuinely worthless.
      console.log(
        `${snap.totals.unpricedCount} asset(s) carry NO price and contributed $0.\n` +
          `The figure above is a lower bound, not a valuation.`,
      );
    }
    console.log(
      "There is no liquidity signal: nothing here says whether an asset can be sold.",
    );

    if (snap.totals.chainsErrored > 0) {
      // These chains were not proven empty -- they could not be read at all.
      // Exiting non-zero is what makes that visible to a scheduled run.
      console.log(
        `\n${snap.totals.chainsErrored} chain(s) FAILED to scan and are not accounted for above.`,
      );
      process.exitCode = 1;
    }

    if (args.json) {
      fs.writeFileSync(String(args.json), `${JSON.stringify(snap, null, 2)}\n`, "utf8");
      console.log(`\nJSON written: ${args.json}`);
    }
  });
