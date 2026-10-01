/**
 * feeSnapshot.ts
 *
 * Schema and rendering for a cross-chain fee scan snapshot: what was sitting
 * on every OkuRouter at one moment in time.
 *
 * This is deliberately NOT a committed record. Committed fee artifacts
 * (fee-reports/data, fee-reports/reports, ledger.json) describe money that
 * actually moved, reconciled against receipts. A snapshot describes money
 * that merely exists, priced off spot pool state, and it goes stale the
 * moment the next swap lands. Letting the two sit side by side in git would
 * invite someone to read a snapshot as a collection. Snapshots live in
 * fee-reports/scans/ and are gitignored, same rationale as simulations/.
 *
 * What the snapshot IS for:
 *   - one artifact the operator reads to choose which chains to sweep
 *   - the input to `safe:build --intent sweep --from-scan`, so the bundle is
 *     built from the exact numbers that were reviewed rather than a second,
 *     independently-drifted scan
 *   - a per-chain status that distinguishes "nothing to sweep" from "we could
 *     not find out", which the build path alone cannot express
 *
 * It must never contain RPC URLs: configured endpoints carry API keys.
 */
import * as fs from "fs";
import * as path from "path";
import { NATIVE_SENTINEL, fmtAmount, type PricedFeeAsset } from "./feeScan";

const REPORTS_DIR = path.resolve(__dirname, "..", "fee-reports");
const SCANS_DIR = path.join(REPORTS_DIR, "scans");

/**
 * Per-chain outcome.
 *
 * `error` exists because the build path cannot express it: a chain that threw
 * mid-scan and a chain with nothing to sweep both simply vanish from a
 * bundle. Across 34 chains that is a silent loss of collectable fees, so the
 * distinction is made explicit here and surfaced in the exit code.
 */
export type ChainScanStatus = "has-fees" | "empty" | "no-rpc" | "no-config" | "error";

export interface SnapshotAsset {
  token: string;
  symbol: string;
  decimals: number;
  amountRaw: string;
  amount: string;
  usdPrice?: number;
  usdValue?: number;
  priceSource?: string;
}

export interface SnapshotChain {
  network: string;
  chainId: number;
  router?: string;
  status: ChainScanStatus;
  /** Truncated failure message when status is "error". */
  error?: string;
  /** Multicall3 balance-probe stats, absent when the chain could not be read. */
  probe?: {
    /** Candidate addresses submitted. */
    candidates: number;
    /** eth_calls the scan cost. */
    calls: number;
    /** Candidates found holding a non-zero balance. */
    found: number;
    /**
     * Candidates the probe could NOT check.
     *
     * Not the same as "holds nothing". Recorded separately so a batch the
     * node refused cannot be read as an empty result.
     */
    unchecked: number;
    /** Where the candidate set came from. */
    sources: { seed: number; tokenList: number; chainConfig: number };
  };
  warnings: string[];
  assets: SnapshotAsset[];
  totals: {
    assetCount: number;
    usdNotional: number;
    /**
     * Assets carrying no USD value at all.
     *
     * Recorded because a bare "$0.00" cannot distinguish "this router holds
     * nothing" from "we could not value anything it holds", and on
     * 2026-09-30 eleven chains printed the former while meaning the latter.
     */
    unpricedCount: number;
  };
}

export interface FeeScanSnapshot {
  kind: "oku-fee-scan";
  schemaVersion: 1;
  generatedAt: string;
  /** UTC date the scan ran. Wall clock is correct here: a snapshot is an
   *  observation of now, not a reconstruction of a past block. */
  date: string;
  chains: SnapshotChain[];
  totals: {
    chainsScanned: number;
    chainsWithFees: number;
    chainsEmpty: number;
    chainsErrored: number;
    usdNotional: number;
    /** Assets across all chains with no USD value. See SnapshotChain.totals. */
    unpricedCount: number;
  };
}

/** Serialize a priced asset for the snapshot. Undefined price fields are omitted. */
export function toSnapshotAsset(a: PricedFeeAsset): SnapshotAsset {
  return {
    token: a.token,
    symbol: a.symbol,
    decimals: a.decimals,
    amountRaw: a.balance.toString(),
    amount: fmtAmount(a),
    usdPrice: a.usdPrice,
    usdValue: a.usdValue,
    priceSource: a.priceSource,
  };
}

/** Roll per-chain results into a snapshot, computing the cross-chain totals. */
export function buildSnapshot(chains: SnapshotChain[]): FeeScanSnapshot {
  const now = new Date();
  let usdNotional = 0;
  let unpricedCount = 0;
  for (const c of chains) {
    usdNotional += c.totals.usdNotional;
    unpricedCount += c.totals.unpricedCount ?? 0;
  }
  return {
    kind: "oku-fee-scan",
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    chains,
    totals: {
      chainsScanned: chains.length,
      chainsWithFees: chains.filter((c) => c.status === "has-fees").length,
      chainsEmpty: chains.filter((c) => c.status === "empty").length,
      chainsErrored: chains.filter((c) => c.status === "error").length,
      usdNotional,
      unpricedCount,
    },
  };
}

/** Chains with something to sweep, richest first. */
export function sweepableChains(snap: FeeScanSnapshot): SnapshotChain[] {
  return snap.chains
    .filter((c) => c.status === "has-fees")
    .sort((a, b) => b.totals.usdNotional - a.totals.usdNotional);
}

/**
 * Chains whose realizable total clears `minUsd`.
 *
 * The default threshold is 0 -- every chain holding anything is included --
 * because the decision of what is worth a signing ceremony belongs to the
 * operator, not to a constant in this file. The lever exists so that decision
 * can be applied in one flag rather than by hand-listing networks.
 */
export function chainsAboveThreshold(snap: FeeScanSnapshot, minUsd: number): SnapshotChain[] {
  return sweepableChains(snap).filter((c) => c.totals.usdNotional >= minUsd);
}

function usd(n: number | undefined): string {
  if (n === undefined) return "-";
  return `$${n.toFixed(2)}`;
}

/** Where a snapshot for `date` with `stamp` lives. */
export function snapshotPaths(date: string, stamp: string): { json: string; md: string; dir: string } {
  const dir = path.join(SCANS_DIR, date);
  return { dir, json: path.join(dir, `${stamp}.json`), md: path.join(dir, `${stamp}.md`) };
}

/** Atomic write of both artifacts. Returns the paths written. */
export function writeSnapshot(snap: FeeScanSnapshot, stamp: string): { json: string; md: string } {
  const { dir, json, md } = snapshotPaths(snap.date, stamp);
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(json, `${JSON.stringify(snap, null, 2)}\n`);
  writeAtomic(md, renderSnapshotMarkdown(snap));
  return { json, md };
}

/** Read a snapshot back, validating the envelope. */
export function readSnapshot(file: string): FeeScanSnapshot {
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));
  if (snap?.kind !== "oku-fee-scan" || snap.schemaVersion !== 1) {
    throw new Error(`${file} is not an oku-fee-scan v1 snapshot`);
  }
  return snap as FeeScanSnapshot;
}

function writeAtomic(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, file);
}

/** Human-readable cross-chain report. */
export function renderSnapshotMarkdown(snap: FeeScanSnapshot): string {
  const L: string[] = [];
  L.push(`# Fee scan — ${snap.date}`);
  L.push("");
  L.push(
    "Snapshot of idle protocol fees. Not a record of collection: nothing here has moved,",
  );
  L.push("and the valuations go stale as soon as prices move.");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push(`| Generated | ${snap.generatedAt} |`);
  L.push(`| Chains scanned | ${snap.totals.chainsScanned} |`);
  L.push(`| With fees | ${snap.totals.chainsWithFees} |`);
  L.push(`| Empty | ${snap.totals.chainsEmpty} |`);
  L.push(`| Errored | ${snap.totals.chainsErrored} |`);
  L.push(`| Total notional | ${usd(snap.totals.usdNotional)} |`);
  L.push(`| Assets with no price | ${snap.totals.unpricedCount ?? 0} |`);
  L.push("");
  L.push("Notional is price x balance, priced from DefiLlama.");
  L.push("");
  L.push(
    "There is **no liquidity signal here**. Valuation no longer reads on-chain pools, so",
  );
  L.push(
    "nothing below distinguishes an asset that can be sold from one that merely quotes a",
  );
  L.push("price. Treat every figure as an upper bound on what is actually recoverable.");
  L.push("");
  if ((snap.totals.unpricedCount ?? 0) > 0) {
    L.push(
      `**${snap.totals.unpricedCount} asset(s) carry no price and contribute $0 to the total.**`,
    );
    L.push("The total is therefore also a LOWER BOUND on value. A chain showing $0.00 with");
    L.push("unpriced assets has not been shown to be empty.");
    L.push("");
  }

  const sweepable = sweepableChains(snap);
  L.push("## Chains holding fees");
  L.push("");
  if (sweepable.length === 0) {
    L.push("None.");
  } else {
    L.push(
      "| Chain | Chain ID | Assets | Unpriced | Notional | Candidates | Calls | Unchecked |",
    );
    L.push("|---|---:|---:|---:|---:|---:|---:|---:|");
    for (const c of sweepable) {
      const unp = c.totals.unpricedCount ?? 0;
      const unchecked = c.probe?.unchecked ?? 0;
      L.push(
        `| ${c.network} | ${c.chainId} | ${c.totals.assetCount} | ${unp || "—"} | ` +
          `${usd(c.totals.usdNotional)} | ${c.probe?.candidates ?? "—"} | ` +
          `${c.probe?.calls ?? "—"} | ${unchecked ? `**${unchecked}**` : "—"} |`,
      );
    }
  }
  L.push("");

  // A batch the node refused is not an empty router. Surfaced separately
  // because it is the one failure the probe cannot make good on its own.
  const incomplete = snap.chains.filter((c) => (c.probe?.unchecked ?? 0) > 0);
  if (incomplete.length) {
    L.push("## Incomplete reads — these chains were not fully checked");
    L.push("");
    L.push("Some candidate balances could not be read, so anything held in them is invisible");
    L.push("here. A `$0.00` for those assets means *we could not look*, not *nothing there*.");
    L.push("");
    for (const c of incomplete) {
      L.push(
        `- **${c.network}** (${c.chainId}): ${c.probe!.unchecked} of ` +
          `${c.probe!.candidates} candidate(s) unchecked`,
      );
    }
    L.push("");
  }

  const errored = snap.chains.filter((c) => c.status === "error");
  const unreachable = snap.chains.filter(
    (c) => c.status === "no-rpc" || c.status === "no-config",
  );
  if (errored.length || unreachable.length) {
    L.push("## Needs attention");
    L.push("");
    L.push(
      "These chains were NOT proven empty — they could not be read. Anything sitting on",
    );
    L.push("them is invisible to this scan and will not appear in a bundle built from it.");
    L.push("");
    for (const c of errored) L.push(`- **${c.network}** (${c.chainId}): ${c.error}`);
    for (const c of unreachable) L.push(`- **${c.network}** (${c.chainId}): ${c.status}`);
    L.push("");
  }

  const empty = snap.chains.filter((c) => c.status === "empty");
  if (empty.length) {
    L.push(`## Empty (${empty.length})`);
    L.push("");
    L.push(empty.map((c) => c.network).join(", "));
    L.push("");
  }

  for (const c of sweepable) {
    L.push(`## ${c.network} (${c.chainId})`);
    L.push("");
    L.push(`Router \`${c.router}\``);
    L.push("");
    L.push("| Asset | Amount | USD | Price source | Address |");
    L.push("|---|---:|---:|---|---|");
    for (const a of c.assets) {
      L.push(
        `| ${a.symbol} | ${a.amount} | ${usd(a.usdValue)} | ${a.priceSource ?? "—"} | ` +
          `${a.token === NATIVE_SENTINEL ? "(native)" : `\`${a.token}\``} |`,
      );
    }
    L.push("");
    if (c.warnings.length) {
      for (const w of c.warnings) L.push(`- ${w}`);
      L.push("");
    }
  }

  return `${L.join("\n")}\n`;
}
