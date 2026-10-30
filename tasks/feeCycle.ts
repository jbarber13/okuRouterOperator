/**
 * fees:cycle
 *
 * One command for a fee collection round:
 *
 *   1. scan every deployed chain for idle protocol fees
 *   2. write a snapshot (JSON + markdown) of what is available
 *   3. build the multi-chain sweep bundle from those exact numbers
 *   4. emit the signing page the hardware wallets use
 *
 * Why it is one task rather than four commands
 * --------------------------------------------
 * The scan and the build each have to discover which assets have ever flowed
 * through each router. Run separately they do that work twice, against chain
 * state that has moved in between, so the report an operator approved and the
 * bundle they end up signing can disagree. Here the scan happens once and the
 * build consumes it (`safe:build --from-scan`), which makes the snapshot the
 * authorization record for the bundle rather than a parallel opinion.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * It does not filter by value. `--min-usd` defaults to 0, so every chain
 * holding anything is built. Deciding that a chain is not worth a 2-of-3
 * hardware ceremony is an operator judgement, and at 34 chains that decision
 * is worth seeing rather than inheriting from a constant. The ranked table
 * and the copy-pasteable `--networks` line exist to make acting on it cheap.
 *
 * It does not execute. Collecting signatures is a separate, human step; see
 * `safe:exec` once the page reports every chain at threshold.
 *
 * Usage:
 *   npx hardhat fees:cycle --scan-only
 *   npx hardhat fees:cycle
 *   npx hardhat fees:cycle --networks base,arbitrum --name sweep-2026-09-22
 *   npx hardhat fees:cycle --min-usd 25
 *
 * Candidates come from the curated data/fee-tokens.json. Before the scan,
 * every chain a balance API covers (util/balanceDiscovery.ts: Alchemy
 * Portfolio + Ankr) is asked for EVERYTHING the router holds; held tokens
 * the list does not know are re-read on chain, priced, and -- if worth at
 * least --discover-min-usd at a firm price and they pass the sweep vet --
 * ADDED to data/fee-tokens.json and swept this cycle. The rest are recorded
 * as `ignored` so spam airdrops are not re-priced every run. Additions are
 * listed in the snapshot, the bundle manifest and the signing page.
 *
 * With --scan-only the additions are applied in memory (so the report shows
 * them) but data/fee-tokens.json is not written. --no-discover skips the step.
 */
import * as fs from "fs";
import * as path from "path";
import { task } from "hardhat/config";
import { listSafeChains, mapLimit, pad } from "../util/safeChains";
import { scanChainForSnapshot } from "../util/feeSweepScan";
import { loadFeeTokens, saveFeeTokens } from "../util/feeTokens";
import { discoverHoldings } from "../util/balanceDiscovery";
import {
  applyDiscovery,
  DEFAULT_DISCOVERY_MIN_USD,
  type ChainDiscoveryOutcome,
} from "../util/feeDiscovery";
import { getOkuSafeDeployment } from "../util/safeConfig";
import {
  buildSnapshot,
  chainsAboveThreshold,
  sweepableChains,
  writeSnapshot,
} from "../util/feeSnapshot";

const BUNDLE_DIR = path.resolve(__dirname, "..", "safe-bundles");

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function printDiscovery(outcomes: ChainDiscoveryOutcome[], minUsd: number): void {
  console.log(`\n  ${pad("chain", 14)}${pad("source", 15)}${pad("held", 7)}${pad("new", 6)}${pad("added", 7)}ignored`);
  for (const o of outcomes) {
    const src = o.status === "covered" ? o.source : o.status === "failed" ? "FAILED" : "none";
    console.log(
      `  ${pad(o.network, 14)}${pad(src, 15)}${pad(o.status === "covered" ? String(o.held) : "-", 7)}` +
        `${pad(o.status === "covered" ? String(o.evaluated) : "-", 6)}${pad(String(o.added.length || "-"), 7)}` +
        `${o.ignored.length || "-"}${o.error ? `   ! ${o.error}` : ""}`,
    );
  }
  const added = outcomes.flatMap((o) => o.added.map((a) => ({ o, a })));
  if (added.length) {
    console.log(`\n  ADDED to the sweep list (${added.length}):`);
    for (const { o, a } of added) {
      console.log(`    ${pad(o.network, 12)}${pad(a.symbol, 12)}${pad(usd(a.usdValue), 11)}${a.token}  ${a.priceSource ?? ""}`);
    }
  }
  // Thin-priced holdings worth >= the bar are ignored like spam (a thin
  // price cannot be realised), but a real token with a shallow market looks
  // the same. Shown so a human can promote one by hand if it is genuine.
  const review = outcomes.flatMap((o) =>
    o.ignored.filter((i) => (i.usdValueThin ?? 0) >= minUsd).map((i) => ({ o, i })),
  );
  if (review.length) {
    console.log(`\n  IGNORED but thin-valued >= ${usd(minUsd)} (not swept; usually impostors -- check before promoting):`);
    for (const { o, i } of review) {
      console.log(`    ${pad(o.network, 12)}${pad(i.symbol ?? "?", 12)}${pad(usd(i.usdValueThin!), 11)}${i.token}  ${i.reason}`);
    }
  }
  for (const o of outcomes) {
    for (const e of o.excluded) console.log(`  ! ${o.network}: excluded ${e.token}  ${e.reason}`);
    for (const w of o.warnings) if (/balance API failed/.test(w)) console.log(`  ! ${w}`);
  }
}

task("fees:cycle", "Scan every chain for idle fees, build the sweep bundle, emit the signing page")
  .addOptionalParam("networks", "Comma-separated hardhat network names (default: all deployed)")
  .addOptionalParam("name", "Bundle name (default: sweep-<date>)")
  .addOptionalParam("to", "Sweep recipient (default: OKU_FEE_RECIPIENT)")
  .addOptionalParam("minUsd", "Skip chains whose realizable total is below this (default 0)")
  .addOptionalParam("concurrency", "Chains scanned in parallel (default 4)")
  .addOptionalParam(
    "discoverMinUsd",
    `Firm USD value a newly discovered token needs to be added (default ${DEFAULT_DISCOVERY_MIN_USD})`,
  )
  .addFlag("noDiscover", "Skip balance-API discovery; sweep the curated list as-is")
  .addFlag("scanOnly", "Stop after the snapshot; do not build a bundle")
  .addFlag("noEth", "Do NOT sweep the native balance")
  .addFlag("force", "Overwrite an existing bundle of the same name")
  .addFlag(
    "acceptPartial",
    "Proceed even when some chains were not fully checked (their $0.00 means " +
      "'could not look', not 'nothing there')",
  )
  .setAction(async (args, hre) => {
    const only = args.networks
      ? new Set(String(args.networks).split(",").map((s: string) => s.trim()).filter(Boolean))
      : undefined;
    const minUsd = args.minUsd ? Number(args.minUsd) : 0;
    const concurrency = args.concurrency ? Number(args.concurrency) : 4;
    const chains = listSafeChains(hre, only).filter((c) => c.router);

    if (chains.length === 0) {
      console.log("No chains matched (or none have an OkuRouter in deployments/).");
      return;
    }

    const started = new Date();
    const stamp = started.toISOString().replace(/[:.]/g, "-").slice(11, 19);
    const date = started.toISOString().slice(0, 10);

    console.log("\n" + "=".repeat(96));
    console.log(`FEE CYCLE  ${started.toISOString()}`);
    console.log("=".repeat(96));
    console.log(`Chains       : ${chains.length}`);
    console.log(`Candidates   : data/fee-tokens.json (curated)`);
    const curated = loadFeeTokens();
    console.log("");

    // ---- 0. discovery -----------------------------------------------------
    const discovery = new Map<string, ChainDiscoveryOutcome>();
    if (!args.noDiscover) {
      const discMin = args.discoverMinUsd !== undefined ? Number(args.discoverMinUsd) : DEFAULT_DISCOVERY_MIN_USD;
      if (!(Number.isFinite(discMin) && discMin >= 0)) throw new Error("--discover-min-usd must be a number >= 0");
      console.log(`Discovery    : balance APIs (Alchemy Portfolio, Ankr), add if firm >= ${usd(discMin)}`);
      const holdings = await discoverHoldings(
        chains.filter((c) => c.router).map((c) => ({ network: c.network, router: c.router! })),
      );
      const safe = getOkuSafeDeployment().address;
      const outcomes = await mapLimit(chains, concurrency, (chain) =>
        applyDiscovery(chain, curated, holdings.get(chain.network), { safe, minUsd: discMin }),
      );
      for (const o of outcomes) discovery.set(o.network, o);
      printDiscovery(outcomes, discMin);
      const changed = outcomes.some((o) => o.added.length || o.ignored.length || o.excluded.length);
      if (changed && !args.scanOnly) {
        saveFeeTokens(curated);
        console.log(`\n  data/fee-tokens.json updated -- commit it with this cycle's reports.`);
      } else if (changed) {
        console.log(`\n  --scan-only: changes applied in memory for this report; data/fee-tokens.json NOT written.`);
      }
      console.log("");
    }

    // ---- 1. scan ----------------------------------------------------------
    let done = 0;
    const results = await mapLimit(chains, concurrency, async (chain) => {
      const r = await scanChainForSnapshot(chain, { price: true, curated });
      done++;
      const detail =
        r.status === "has-fees"
          ? `${r.totals.assetCount} asset(s)  notional ${usd(r.totals.usdNotional)}`
          : r.status === "error"
            ? `ERROR: ${r.error}`
            : r.status;
      console.log(`  [${String(done).padStart(2)}/${chains.length}] ${pad(chain.network, 12)} ${detail}`);
      return r;
    });

    // ---- 2. snapshot ------------------------------------------------------
    for (const r of results) {
      const o = discovery.get(r.network);
      if (!o) continue;
      r.discovery = {
        status: o.status,
        source: o.source,
        held: o.held,
        added: o.added.map((a) => ({
          token: a.token,
          symbol: a.symbol,
          amountRaw: a.amountRaw,
          usdValue: a.usdValue,
          ...(a.priceSource ? { priceSource: a.priceSource } : {}),
        })),
        ignored: o.ignored.length,
        excluded: o.excluded.length,
        ...(o.error ? { error: o.error } : {}),
      };
    }
    const snap = buildSnapshot(results);
    const written = writeSnapshot(snap, stamp);

    const sweepable = sweepableChains(snap);
    const selected = chainsAboveThreshold(snap, minUsd);

    console.log("\n" + "-".repeat(96));
    console.log("AVAILABLE TO SWEEP");
    console.log("-".repeat(96));
    if (sweepable.length === 0) {
      console.log("Nothing on any chain.");
    } else {
      console.log(
        `  ${pad("chain", 14)}${pad("assets", 8)}${pad("unpriced", 10)}${pad("notional", 13)}${pad("thin", 11)}` +
          `${pad("candidates", 12)}unchecked`,
      );
      for (const c of sweepable) {
        const un = c.probe?.unchecked ?? 0;
        console.log(
          `  ${pad(c.network, 14)}${pad(String(c.totals.assetCount), 8)}` +
            `${pad(String(c.totals.unpricedCount || "-"), 10)}` +
            `${pad(usd(c.totals.usdNotional), 13)}` +
            `${pad(c.totals.thinCount ? usd(c.totals.thinUsd ?? 0) : "-", 11)}` +
            `${pad(String(c.probe?.candidates ?? "-"), 12)}${un ? `${un}  <-- NOT CHECKED` : "-"}`,
        );
      }
    }
    console.log("-".repeat(96));
    console.log(
      `  TOTAL  notional ${usd(snap.totals.usdNotional)}` +
        `${snap.totals.thinCount ? `  + ${usd(snap.totals.thinUsd ?? 0)} thin (${snap.totals.thinCount}, not counted)` : ""}` +
        `${snap.totals.unpricedCount ? `  ${snap.totals.unpricedCount} with no price` : ""}` +
        `   across ${sweepable.length} chain(s)`,
    );
    console.log(
      "  Firm prices only in totals: reviewed alias, DefiLlama >= 0.9 confidence, or a DEX\n" +
        "  pool with >= $10k reserve. Thin and unpriced assets contribute $0.",
    );

    // Chains that could not be read are NOT chains with nothing to collect.
    // Saying so out loud, and failing the exit code, is the only thing that
    // stops a scheduled run from quietly skipping them week after week.
    const unread = snap.chains.filter(
      (c) => c.status === "error" || c.status === "no-rpc" || c.status === "no-config",
    );
    if (unread.length) {
      console.log("\n" + "!".repeat(96));
      console.log(
        `${unread.length} chain(s) COULD NOT BE READ. They are not empty -- their state is ` +
          `unknown,\nand anything on them will not appear in the bundle:`,
      );
      for (const c of unread) {
        console.log(`  ${pad(c.network, 14)}${c.status}${c.error ? `: ${c.error}` : ""}`);
      }
      console.log("!".repeat(96));
      process.exitCode = 1;
    }

    // Discovery quality is a separate failure mode from "could not be read",
    // and a more insidious one: an `unreliable` chain returns a perfectly
    // well-formed $0.00 that looks identical to a genuinely empty chain.
    //
    // This is not hypothetical. On 2026-09-29 avax scanned 0.004% of history,
    // discovered one token, reported $0.00, and was swept -- leaving nine
    // tokens including USDC 1,173 behind. The scan warned; the warning was one
    // line among 34 chains and was missed. So this now fails the exit code and
    // requires an explicit acknowledgement to proceed.
    const unreliable = snap.chains.filter((c) => (c.probe?.unchecked ?? 0) > 0);
    if (unreliable.length) {
      console.log("\n" + "!".repeat(96));
      console.log(
        `${unreliable.length} chain(s) were NOT fully checked. Some candidate balances could ` +
          `not\nbe read, so a $0.00 for those assets means "we could not look", not "there is\n` +
          `nothing". Anything held in them will be left behind by a bundle built from this\nscan.`,
      );
      for (const c of unreliable) {
        console.log(
          `  ${pad(c.network, 14)}${pad(`${c.probe!.unchecked} unchecked`, 18)}` +
            `of ${c.probe!.candidates} candidate(s)`,
        );
      }
      console.log(
        `\n  Usually a flaky endpoint: re-run, or set ${"<NET>"}_URL to a better one.`,
      );
      console.log(
        `  Or re-run with --accept-partial to proceed anyway, having read the above.`,
      );
      console.log("!".repeat(96));
      if (!args.acceptPartial) {
        process.exitCode = 1;
      }
    }

    console.log(`\nSnapshot: ${written.json}`);
    console.log(`Report  : ${written.md}`);
    console.log(
      "(gitignored -- a snapshot is money that exists, not money that moved. Only the\n" +
        " accounting written at execution time is a durable record.)",
    );

    if (sweepable.length) {
      console.log(`\nTo narrow the ceremony, re-run with:`);
      console.log(`  --networks ${sweepable.map((c) => c.network).join(",")}`);
    }

    if (args.scanOnly) {
      console.log("\n--scan-only: stopping before the bundle.\n");
      return;
    }

    // Refuse to build a bundle off a scan we know is blind on some chains.
    // Sweeping an `unreliable` chain is worse than skipping it: sweepAll moves
    // only the tokens named in the calldata, so a blind sweep burns the Safe
    // nonce and a 2-of-3 signing ceremony to collect the three well-known
    // tokens while leaving the rest sitting there -- and produces an
    // accounting record that looks like a complete collection.
    if (unreliable.length && !args.acceptPartial) {
      throw new Error(
        `refusing to build a bundle: ${unreliable.length} chain(s) have unreliable ` +
          `discovery (${unreliable.map((c) => c.network).join(", ")}). Point them at a ` +
          `better <NET>_URL endpoint, or pass --accept-partial to sweep them blind anyway.`,
      );
    }

    if (selected.length === 0) {
      console.log(
        minUsd > 0
          ? `\nNo chain cleared --min-usd ${usd(minUsd)}. No bundle written.\n`
          : "\nNothing to sweep on any chain. No bundle written.\n",
      );
      return;
    }

    // ---- 3. build ---------------------------------------------------------
    const name = String(args.name ?? `sweep-${date}`);
    const bundlePath = path.join(BUNDLE_DIR, `${name}.json`);
    if (fs.existsSync(bundlePath) && !args.force) {
      // Overwriting matters: a rebuilt bundle carries fresh Safe nonces, so
      // every signature already collected against the old one becomes dead
      // weight that safe:exec will reject as stale. Make that a decision.
      throw new Error(
        `bundle "${name}" already exists at ${bundlePath}. Rebuilding it would invalidate ` +
          `any signatures already collected (new nonces => new safeTxHashes). Pass --name ` +
          `<other> for a separate ceremony, or --force if the old one is genuinely dead.`,
      );
    }

    console.log("\n" + "=".repeat(96));
    console.log(`BUILDING SWEEP BUNDLE  "${name}"  across ${selected.length} chain(s)`);
    console.log("=".repeat(96));

    await hre.run("safe:build", {
      intent: "sweep",
      name,
      networks: selected.map((c) => c.network).join(","),
      fromScan: written.json,
      ...(args.to ? { to: String(args.to) } : {}),
      ...(minUsd > 0 ? { minUsd: String(minUsd) } : {}),
      noEth: Boolean(args.noEth),
    });

    if (!fs.existsSync(bundlePath)) {
      console.log("\nNo bundle was produced; skipping the signing page.\n");
      return;
    }

    // ---- 4. signing page --------------------------------------------------
    await hre.run("safe:sign-page", { name });

    console.log("=".repeat(96));
    console.log("NEXT");
    console.log("=".repeat(96));
    console.log(`  1. npm run sign-page`);
    console.log(`  2. each owner opens http://127.0.0.1:8547/${name}/sign.html and signs`);
    console.log(`  3. npx hardhat safe:exec --name ${name}            # dry run`);
    console.log(`  4. npx hardhat safe:exec --name ${name} --broadcast`);
    console.log("");
    console.log(
      "  Signatures are bound to the Safe nonce at build time. If anything else executes\n" +
        "  through the Safe in the meantime, safe:exec rejects the bundle as stale and the\n" +
        "  ceremony has to be repeated -- so collect signatures promptly.",
    );
    console.log("");
  });
