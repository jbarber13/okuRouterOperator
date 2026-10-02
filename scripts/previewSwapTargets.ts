/**
 * previewSwapTargets.ts
 *
 * Read-only preview of what `safe:build --intent swap-targets` WOULD emit,
 * across every chain, without needing the Safe to own the router yet.
 *
 * Exists because the real build cannot run until the v2 Safe owns the
 * routers: its pre-sign simulation issues `updateSwapTargets` from the Safe,
 * which reverts `onlyOwner` while ownership is still pending. This reproduces
 * the intent's selection logic exactly -- same config source, same
 * already-whitelisted skip, same no-bytecode skip -- so the bundle's contents
 * are known and reviewable before the ceremony rather than discovered during
 * it.
 *
 * Deliberately runs on ALL chains, not just the ones a release is expected to
 * touch: the intent reconciles the full knownSwapTargets set against chain
 * state, so anything unexpected here is real drift and should be understood
 * before it is folded into a signing ceremony.
 *
 * Usage: [NETWORKS=a,b] npx hardhat run scripts/previewSwapTargets.ts
 */
import hre from "hardhat";
import { Interface, getAddress } from "ethers";
import { NETWORK_CONFIGS } from "../util/deploymentConfig";
import { listSafeChains, makeProvider, mapLimit } from "../util/safeChains";

const ROUTER = new Interface([
  "function swapTargets(address) view returns (bool)",
  "function owner() view returns (address)",
]);

async function main() {
  const only = process.env.NETWORKS
    ? new Set(process.env.NETWORKS.split(",").map((s) => s.trim()).filter(Boolean))
    : undefined;
  const chains = listSafeChains(hre as never, only).filter((c) => c.router && c.rpcUrl);

  type Row = {
    network: string;
    configured: number;
    missing: { name: string; address: string; code: boolean }[];
    skippedNoCode: string[];
    owner: string;
    err?: string;
  };

  const rows: Row[] = await mapLimit(chains, 4, async (c) => {
    const row: Row = { network: c.network, configured: 0, missing: [], skippedNoCode: [], owner: "?" };
    try {
      const p = makeProvider(c.rpcUrl, c.chainId);
      row.owner = getAddress(
        ROUTER.decodeFunctionResult(
          "owner",
          await p.call({ to: c.router!, data: ROUTER.encodeFunctionData("owner") }),
        )[0] as string,
      );
      const cfg = NETWORK_CONFIGS[c.network];
      if (!cfg) { row.err = "NO_NETWORK_CONFIG"; return row; }
      row.configured = cfg.knownSwapTargets.length;
      for (const t of cfg.knownSwapTargets) {
        const already = ROUTER.decodeFunctionResult(
          "swapTargets",
          await p.call({
            to: c.router!,
            data: ROUTER.encodeFunctionData("swapTargets", [t.address]),
          }),
        )[0] as boolean;
        if (already) continue;
        const code = (await p.getCode(t.address)) !== "0x";
        if (!code) { row.skippedNoCode.push(`${t.name} ${t.address}`); continue; }
        row.missing.push({ name: t.name, address: getAddress(t.address), code });
      }
    } catch (e) {
      row.err = (e as Error).message.slice(0, 60);
    }
    return row;
  });

  let totalCalls = 0;
  const withWork: Row[] = [];
  const errs: Row[] = [];
  for (const r of rows) {
    if (r.err) { errs.push(r); continue; }
    totalCalls += r.missing.length;
    if (r.missing.length || r.skippedNoCode.length) withWork.push(r);
  }

  console.log(`\nchains checked: ${rows.length}\n`);
  if (withWork.length === 0) console.log("No chain needs any swap-target change.");
  for (const r of withWork) {
    console.log(`${r.network}  (${r.configured} configured, owner ${r.owner})`);
    for (const m of r.missing) console.log(`    + ${m.name.padEnd(14)} ${m.address}`);
    for (const s of r.skippedNoCode) console.log(`    ~ SKIPPED (no bytecode): ${s}`);
  }
  if (errs.length) {
    console.log("\nchains that could not be read (NOT proven clean):");
    for (const r of errs) console.log(`    ! ${r.network}: ${r.err}`);
  }
  console.log(`\nbundle would contain ${totalCalls} call(s) across ${withWork.filter((r) => r.missing.length).length} chain(s).`);
  if (errs.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
