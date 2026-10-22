/**
 * checkPricing.ts
 *
 * Live pricing-coverage report: re-prices the assets of a fee-scan snapshot
 * through the current source chain (alias -> DefiLlama -> GeckoTerminal) and
 * reports coverage by count and by value, by source, and every asset left
 * thin or unpriced with its reason. Read-only.
 *
 * Usage: [SCAN=fee-reports/scans/<date>/<time>.json] [NETWORKS=a,b] \
 *          npx hardhat run scripts/checkPricing.ts
 * Default SCAN: the newest snapshot under fee-reports/scans/.
 */
import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";
import { listSafeChains, makeProvider, mapLimit, pad } from "../util/safeChains";
import { NETWORK_CONFIGS } from "../util/deploymentConfig";
import { priceAssets, totalUsd, type FeeAsset, type PricedFeeAsset } from "../util/feeScan";
import { readSnapshot } from "../util/feeSnapshot";

function newestScan(): string {
  const root = path.resolve(__dirname, "..", "fee-reports", "scans");
  const files: string[] = [];
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const dir = path.join(root, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".json")) files.push(path.join(dir, f));
  }
  if (!files.length) throw new Error("no snapshots under fee-reports/scans; run fees:scan --json or fees:cycle --scan-only");
  return files.sort().at(-1)!;
}

async function main() {
  const file = process.env.SCAN ? path.resolve(process.env.SCAN) : newestScan();
  const snap = readSnapshot(file);
  const only = process.env.NETWORKS ? new Set(process.env.NETWORKS.split(",")) : undefined;
  const chains = listSafeChains(hre as never);
  console.log(`snapshot ${path.relative(process.cwd(), file)}  (${snap.generatedAt})\n`);

  const perChain = await mapLimit(
    snap.chains.filter((c) => c.assets.length && (!only || only.has(c.network))),
    4,
    async (c) => {
      const cfg = NETWORK_CONFIGS[c.network];
      const sc = chains.find((x) => x.network === c.network);
      if (!cfg || !sc?.rpcUrl) return { network: c.network, priced: [] as PricedFeeAsset[], err: "no config/rpc" };
      const provider = makeProvider(sc.rpcUrl, c.chainId);
      try {
        const assets: FeeAsset[] = c.assets.map((a) => ({
          token: a.token,
          symbol: a.symbol,
          decimals: a.decimals,
          balance: BigInt(a.amountRaw),
        }));
        const { priced } = await priceAssets(provider, cfg, assets);
        return { network: c.network, priced, err: undefined as string | undefined, oldUnpriced: c.totals.unpricedCount };
      } catch (e) {
        return { network: c.network, priced: [] as PricedFeeAsset[], err: String((e as Error).message).slice(0, 80) };
      } finally {
        provider.destroy();
      }
    },
  );

  const all = perChain.flatMap((c) => c.priced);
  const t = totalUsd(all);
  const firmN = all.filter((a) => a.priceTier === "firm").length;
  console.log(`${pad("chain", 12)}${pad("assets", 8)}${pad("firm", 6)}${pad("thin", 6)}${pad("none", 6)}${pad("firm $", 12)}thin $`);
  for (const c of perChain) {
    if (c.err) {
      console.log(`${pad(c.network, 12)}ERROR ${c.err}`);
      continue;
    }
    const ct = totalUsd(c.priced);
    console.log(
      `${pad(c.network, 12)}${pad(c.priced.length, 8)}${pad(c.priced.length - ct.thinCount - ct.unpriced, 6)}` +
        `${pad(ct.thinCount, 6)}${pad(ct.unpriced, 6)}${pad(`$${ct.notional.toFixed(2)}`, 12)}$${ct.thinUsd.toFixed(2)}`,
    );
  }
  const bySource = new Map<string, number>();
  for (const a of all) {
    const k = (a.priceSource ?? "?").replace(/[:@].*$/, "");
    bySource.set(k, (bySource.get(k) ?? 0) + 1);
  }
  console.log("\n" + "-".repeat(80));
  console.log(
    `assets ${all.length}: firm ${firmN} (${((100 * firmN) / all.length).toFixed(1)}%), ` +
      `thin ${t.thinCount}, unpriced ${t.unpriced}  |  firm $${t.notional.toFixed(2)}, thin $${t.thinUsd.toFixed(2)}`,
  );
  console.log(`by source: ${[...bySource].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`snapshot had: ${snap.totals.unpricedCount} unpriced, $${snap.totals.usdNotional.toFixed(2)}`);

  console.log("\nTHIN (shown, not counted):");
  for (const c of perChain)
    for (const a of c.priced.filter((x) => x.priceTier === "thin"))
      console.log(`  ${pad(c.network, 12)}${pad(a.symbol.slice(0, 10), 11)}$${(a.usdValueThin ?? 0).toFixed(4).padStart(10)}  ${a.priceSource}  ${a.token}`);
  console.log("\nUNPRICED:");
  for (const c of perChain)
    for (const a of c.priced.filter((x) => !x.priceTier))
      console.log(`  ${pad(c.network, 12)}${pad(a.symbol.slice(0, 10), 11)}${pad(a.priceSource, 24)}${a.token}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
