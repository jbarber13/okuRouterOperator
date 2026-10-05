import hre from "hardhat";
import * as fs from "fs";
import { Interface, getAddress } from "ethers";
import { OKU_SAFE_OWNERS, OKU_SAFE_THRESHOLD, getOkuSafeDeployment } from "../util/safeConfig";
import { listSafeChains, makeProvider, mapLimit } from "../util/safeChains";
const I = new Interface([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";
async function main() {
  const dep = getOkuSafeDeployment();
  const SAFE = getAddress(dep.address);
  const wantOwners = OKU_SAFE_OWNERS.map((o) => getAddress(o)).sort().join(",");
  console.log(`\nconfig Safe: ${SAFE}\nconfig owners: ${wantOwners}\n`);
  const chains = listSafeChains(hre as never).filter((c) => c.router && c.rpcUrl);
  let bad = 0;
  const rows = await mapLimit(chains, 4, async (c) => {
    const p: string[] = [];
    try {
      const prov = makeProvider(c.rpcUrl, c.chainId);
      const call = async (to: string, fn: string) =>
        I.decodeFunctionResult(fn, await prov.call({ to, data: I.encodeFunctionData(fn) }))[0];
      const owner = getAddress((await call(c.router!, "owner")) as string);
      const pending = getAddress((await call(c.router!, "pendingOwner")) as string);
      const live = ((await call(SAFE, "getOwners")) as string[]).map((o) => getAddress(o)).sort().join(",");
      const th = Number(await call(SAFE, "getThreshold"));
      const reg = JSON.parse(fs.readFileSync(`deployments/${c.network}.json`, "utf8")).current;
      if (owner !== SAFE) p.push(`chain owner ${owner} != config Safe`);
      if (pending !== getAddress(ZERO)) p.push(`pendingOwner ${pending}`);
      if (live !== wantOwners) p.push(`live owners != config`);
      if (th !== OKU_SAFE_THRESHOLD) p.push(`live threshold ${th}`);
      if (getAddress(reg.Safe.address) !== SAFE) p.push(`registry Safe != config`);
      if (getAddress(reg.OkuRouter.owner) !== SAFE) p.push(`registry owner != config`);
      if (reg.SafeV2 !== undefined) p.push(`registry still has SafeV2 key`);
      if (reg.Safe.owners.map((o: string) => getAddress(o)).sort().join(",") !== wantOwners)
        p.push(`registry owners != config`);
      return { network: c.network, ok: p.length === 0, p };
    } catch (e) { p.push(`rpc: ${(e as Error).message.slice(0, 50)}`); return { network: c.network, ok: false, p }; }
  });
  for (const r of rows) {
    if (!r.ok) { bad++; console.log(`  ${r.network}:`); r.p.forEach((x) => console.log(`      x ${x}`)); }
  }
  console.log(bad === 0
    ? `All ${rows.length} chains: config == registry == chain. Single-Safe production state confirmed.`
    : `${bad} chain(s) inconsistent.`);
  if (bad) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
