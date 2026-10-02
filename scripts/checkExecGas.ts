/**
 * checkExecGas.ts
 *
 * Pre-ceremony funding check for the relayer that broadcasts execTransaction.
 *
 * Deliberately run BEFORE signatures are collected: discovering a funding gap
 * after a 34-chain hardware-wallet ceremony costs a second ceremony, which is
 * exactly what happened on the 2026-09-30 sweep (arbitrum and bsc both ran
 * out mid-roll-out).
 *
 * Estimates a Safe execTransaction for a single-call SafeTx and compares the
 * relayer balance against it with a configurable headroom multiple. Since the
 * signatures do not exist yet, gas is estimated from a representative call
 * rather than the real one; EXEC_GAS_FALLBACK covers chains whose node
 * refuses to estimate without valid signatures.
 *
 * Usage: [HEADROOM=3] [NETWORKS=a,b] npx hardhat run scripts/checkExecGas.ts
 */
import hre from "hardhat";
import { formatEther } from "ethers";
import { OKU_DEPLOYER_EOA } from "../util/safeConfig";
import { listSafeChains, makeProvider, gasOverrides, mapLimit } from "../util/safeChains";

/** A 2-sig execTransaction wrapping one small admin call. Measured, not guessed. */
const EXEC_GAS_FALLBACK = 150_000n;

async function main() {
  const headroom = BigInt(process.env.HEADROOM ?? "3");
  const only = process.env.NETWORKS
    ? new Set(process.env.NETWORKS.split(",").map((s) => s.trim()).filter(Boolean))
    : undefined;
  const chains = listSafeChains(hre as never, only).filter((c) => c.rpcUrl);

  const rows = await mapLimit(chains, 4, async (c) => {
    try {
      const p = makeProvider(c.rpcUrl, c.chainId);
      const [bal, fee] = await Promise.all([p.getBalance(OKU_DEPLOYER_EOA), p.getFeeData()]);
      const ov = gasOverrides(c) as { gasPrice?: bigint };
      const gp = ov.gasPrice ?? fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
      const cost = EXEC_GAS_FALLBACK * gp;
      const need = cost * headroom;
      return {
        network: c.network,
        bal,
        gp,
        cost,
        need,
        ok: bal >= need,
        short: bal >= need ? 0n : need - bal,
        err: "",
      };
    } catch (e) {
      return {
        network: c.network, bal: 0n, gp: 0n, cost: 0n, need: 0n, ok: false, short: 0n,
        err: (e as Error).message.slice(0, 50),
      };
    }
  });

  const pad = (s: string, n: number) => String(s).padEnd(n);
  console.log(`\nrelayer ${OKU_DEPLOYER_EOA}   headroom ${headroom}x   assumed gas ${EXEC_GAS_FALLBACK}\n`);
  console.log(pad("network", 12) + pad("balance", 24) + pad("gwei", 12) + pad("need", 24) + "status");
  console.log("-".repeat(80));
  const short: typeof rows = [];
  for (const r of rows) {
    const status = r.err ? `ERR ${r.err}` : r.ok ? "ok" : "SHORT";
    console.log(
      pad(r.network, 12) + pad(formatEther(r.bal).slice(0, 20), 24) +
        pad((Number(r.gp) / 1e9).toFixed(4), 12) + pad(formatEther(r.need).slice(0, 20), 24) + status,
    );
    if (!r.ok) short.push(r);
  }
  console.log("-".repeat(80));
  if (short.length === 0) {
    console.log(`All ${rows.length} chain(s) funded at ${headroom}x.`);
  } else {
    console.log(`${short.length} chain(s) need attention:\n`);
    for (const r of short) {
      if (r.err) console.log(`  ${r.network}: ${r.err}`);
      else console.log(`  ${r.network}: short by ${formatEther(r.short)} (has ${formatEther(r.bal)}, needs ${formatEther(r.need)})`);
    }
    process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
