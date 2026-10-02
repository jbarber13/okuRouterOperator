/**
 * verifyPendingOwner.ts
 *
 * Post-transfer verification. The whole point of Ownable2Step here is that
 * step 1 changes NOTHING about who controls the router, so this asserts both
 * halves: pendingOwner moved to v2, and owner is still v1. An implementation
 * that silently transferred outright would pass a pendingOwner-only check.
 */
import hre from "hardhat";
import { Interface, getAddress } from "ethers";
import {
  OKU_SAFE_EXPECTED_ADDRESS,
  OKU_SAFE_V2_EXPECTED_ADDRESS,
} from "../util/safeConfig";
import { listSafeChains, makeProvider, mapLimit } from "../util/safeChains";

const I = new Interface([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function nonce() view returns (uint256)",
]);

async function main() {
  const V1 = getAddress(OKU_SAFE_EXPECTED_ADDRESS);
  const V2 = getAddress(OKU_SAFE_V2_EXPECTED_ADDRESS);
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
      const v1Nonce = Number(await call(V1, "nonce"));
      const v2Nonce = Number(await call(V2, "nonce"));
      if (owner !== V1) problems.push(`owner is ${owner}, expected v1 ${V1}`);
      if (pending !== V2) problems.push(`pendingOwner is ${pending}, expected v2 ${V2}`);
      if (v2Nonce !== 0) problems.push(`v2 Safe nonce is ${v2Nonce}, expected 0 (it has not acted)`);
      return {
        network: c.network,
        owner: owner === V1 ? "v1" : owner,
        pending: pending === V2 ? "v2" : pending === "0x0000000000000000000000000000000000000000" ? "none" : pending,
        v1Nonce: String(v1Nonce),
        v2Nonce: String(v2Nonce),
        problems,
      };
    } catch (e) {
      problems.push(`rpc: ${(e as Error).message.slice(0, 60)}`);
      return { network: c.network, owner: "?", pending: "?", v1Nonce: "?", v2Nonce: "?", problems };
    }
  });

  const pad = (s: string, n: number) => String(s).padEnd(n);
  console.log("\n" + pad("network", 12) + pad("owner", 8) + pad("pendingOwner", 14) + pad("v1nonce", 9) + "v2nonce");
  console.log("-".repeat(52));
  for (const r of rows) {
    console.log(pad(r.network, 12) + pad(r.owner, 8) + pad(r.pending, 14) + pad(r.v1Nonce, 9) + r.v2Nonce);
    if (r.problems.length) { bad++; r.problems.forEach((x) => console.log(`    x ${x}`)); }
  }
  console.log("-".repeat(52));
  console.log(bad === 0
    ? `All ${rows.length}: owner still v1, pendingOwner = v2, v2 Safe has never transacted.`
    : `${bad} chain(s) with problems.`);
  if (bad) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
