import hre from "hardhat";
import { Interface, getAddress } from "ethers";
import { OKU_SAFE_EXPECTED_ADDRESS, OKU_SAFE_V2_EXPECTED_ADDRESS, OKU_SAFE_V2_OWNERS } from "../util/safeConfig";
import { listSafeChains, makeProvider, mapLimit } from "../util/safeChains";
const I = new Interface([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
]);
const ZERO = "0x0000000000000000000000000000000000000000";
async function main() {
  const V1 = getAddress(OKU_SAFE_EXPECTED_ADDRESS), V2 = getAddress(OKU_SAFE_V2_EXPECTED_ADDRESS);
  const chains = listSafeChains(hre as never).filter((c) => c.router && c.rpcUrl);
  let bad = 0;
  const rows = await mapLimit(chains, 4, async (c) => {
    const problems: string[] = [];
    try {
      const p = makeProvider(c.rpcUrl, c.chainId);
      const call = async (to: string, fn: string) =>
        I.decodeFunctionResult(fn, await p.call({ to, data: I.encodeFunctionData(fn) }))[0];
      const owner = getAddress((await call(c.router!, "owner")) as string);
      const pending = getAddress((await call(c.router!, "pendingOwner")) as string);
      const n = Number(await call(V2, "nonce"));
      const ow = ((await call(V2, "getOwners")) as string[]).map((o) => getAddress(o)).sort().join(",");
      const want = OKU_SAFE_V2_OWNERS.map((o) => getAddress(o)).sort().join(",");
      if (owner !== V2) problems.push(`owner is ${owner === V1 ? "still v1" : owner}, expected v2`);
      if (pending !== getAddress(ZERO)) problems.push(`pendingOwner is ${pending}, expected 0x0`);
      if (n !== 1) problems.push(`v2 nonce ${n}, expected 1`);
      if (ow !== want) problems.push(`v2 owner set drifted`);
      return { network: c.network, owner: owner === V2 ? "v2" : owner === V1 ? "v1" : owner,
               pending: pending === getAddress(ZERO) ? "none" : pending === V2 ? "v2" : pending,
               nonce: String(n), owners: ow === want ? "ok" : "DRIFT", problems };
    } catch (e) {
      problems.push(`rpc: ${(e as Error).message.slice(0, 50)}`);
      return { network: c.network, owner: "?", pending: "?", nonce: "?", owners: "?", problems };
    }
  });
  const pad = (s: string, n: number) => String(s).padEnd(n);
  console.log("\n" + pad("network", 12) + pad("routerOwner", 13) + pad("pendingOwner", 14) + pad("v2nonce", 9) + "v2owners");
  console.log("-".repeat(56));
  for (const r of rows) {
    console.log(pad(r.network, 12) + pad(r.owner, 13) + pad(r.pending, 14) + pad(r.nonce, 9) + r.owners);
    if (r.problems.length) { bad++; r.problems.forEach((x) => console.log(`    x ${x}`)); }
  }
  console.log("-".repeat(56));
  console.log(bad === 0 ? `All ${rows.length}: owner = v2, pendingOwner cleared, v2 nonce 1. HANDOVER COMPLETE.` : `${bad} chain(s) with problems.`);
  if (bad) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
