/**
 * checkSweepGas.ts
 *
 * Pre-ceremony relayer funding check sized to a SPECIFIC bundle's real calls.
 *
 * checkExecGas.ts estimates a representative single small admin call, which
 * badly undersizes a sweep: a 40-token sweepAll can cost 30x that. On
 * 2026-09-29 mainnet ran out mid-roll-out for exactly that reason. This
 * estimates each chain's actual inner calls from the Safe on the live chain,
 * adds a fixed execTransaction overhead (signature checks, MultiSend
 * delegatecall, event), prices it at the live gas price, and compares
 * HEADROOM x that against the relayer's balance.
 *
 * It cannot see L1 data fees on rollups (not part of eth_gasPrice); HEADROOM
 * (default 3) is what absorbs them.
 *
 * Usage: BUNDLE=<name> [HEADROOM=3] [NETWORKS=a,b] npx hardhat run scripts/checkSweepGas.ts
 */
import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";
import { Wallet, formatEther } from "ethers";
import { listSafeChains, makeProvider, mapLimit, pad } from "../util/safeChains";

/** execTransaction overhead on top of the inner calls (2 ECDSA sigs, MultiSend, events). */
const EXEC_OVERHEAD = 90_000n;

async function main() {
  const name = process.env.BUNDLE;
  if (!name) throw new Error("set BUNDLE=<name>");
  const headroom = BigInt(process.env.HEADROOM ?? "3");
  const bundle = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "safe-bundles", `${name}.json`), "utf8"),
  );
  const only = process.env.NETWORKS ? new Set(process.env.NETWORKS.split(",")) : undefined;
  const chains = listSafeChains(hre as never, only);
  const key = process.env.MAINNET_PRIVATE_KEY;
  if (!key) throw new Error("MAINNET_PRIVATE_KEY not set (needed only to derive the relayer address)");
  const relayer = new Wallet(key).address;
  console.log(`bundle ${name}  relayer ${relayer}  headroom ${headroom}x\n`);

  type Row = { network: string; gas: bigint; need: bigint; bal: bigint; err?: string };
  const rows = await mapLimit(
    bundle.chains as { network: string; chainId: number; calls: { to: string; data: string; value: string }[] }[],
    6,
    async (c): Promise<Row> => {
      const sc = chains.find((x) => x.network === c.network);
      if (!sc?.rpcUrl) return { network: c.network, gas: 0n, need: 0n, bal: 0n, err: "no rpc" };
      const p = makeProvider(sc.rpcUrl, c.chainId);
      try {
        let gas = EXEC_OVERHEAD;
        for (const call of c.calls) {
          gas += await p.estimateGas({ from: bundle.safe, to: call.to, data: call.data, value: BigInt(call.value) });
        }
        const fee = await p.getFeeData();
        const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
        const bal = await p.getBalance(relayer);
        return { network: c.network, gas, need: gas * price * headroom, bal };
      } catch (e) {
        return { network: c.network, gas: 0n, need: 0n, bal: 0n, err: String((e as Error).message).slice(0, 80) };
      } finally {
        p.destroy();
      }
    },
  );

  const short: string[] = [];
  console.log(`${pad("network", 12)}${pad("gas", 12)}${pad("need", 24)}${pad("balance", 24)}status`);
  for (const r of rows) {
    if (r.err) {
      console.log(`${pad(r.network, 12)}?  ${r.err}`);
      short.push(`${r.network}(unknown)`);
      continue;
    }
    const ok = r.bal >= r.need;
    if (!ok) short.push(r.network);
    console.log(
      `${pad(r.network, 12)}${pad(r.gas.toString(), 12)}${pad(formatEther(r.need).slice(0, 20), 24)}` +
        `${pad(formatEther(r.bal).slice(0, 20), 24)}${ok ? "ok" : "FUND"}`,
    );
  }
  console.log(short.length ? `\nneeds attention: ${short.join(", ")}` : `\nall ${rows.length} chains funded at ${headroom}x`);
  if (short.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
