/**
 * verifyV2Safe.ts
 *
 * Independent post-deploy verification of the v2 Safe, deliberately NOT
 * reusing safeDeploy.ts's own verifyDeployedSafe: a deploy task that checks
 * its own work with its own helper can only tell you it was self-consistent.
 * This reads raw storage and raw calls through the repo's own RPC resolution.
 *
 * Checks, per chain:
 *   - bytecode present at the predicted v2 address
 *   - live owner set equals OKU_SAFE_V2_OWNERS, and in the same ORDER
 *   - threshold == 2, VERSION == 1.4.1, nonce == 0 (untouched)
 *   - storage slot 0 singleton is SafeL2 (or L1 on chainId 1)
 *   - zero modules enabled (a module bypasses the threshold entirely)
 *   - the v1 Safe is still intact and still owns the router
 *
 * Usage: npx hardhat run scripts/verifyV2Safe.ts  [--  NETWORKS=a,b,c]
 */
import hre from "hardhat";
import { Interface, getAddress } from "ethers";
import {
  OKU_SAFE_EXPECTED_ADDRESS,
  OKU_SAFE_OWNERS,
  OKU_SAFE_THRESHOLD,
  OKU_SAFE_V2_OWNERS,
  SAFE_L1_SINGLETON,
  SAFE_L2_SINGLETON,
  getOkuSafeDeployment,
} from "../util/safeConfig";
import { listSafeChains, makeProvider, mapLimit } from "../util/safeChains";

const IFACE = new Interface([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function nonce() view returns (uint256)",
  "function getModulesPaginated(address start,uint256 pageSize) view returns (address[] modules,address next)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
]);

const SENTINEL = "0x0000000000000000000000000000000000000001";

async function main() {
  const dep = getOkuSafeDeployment("v2");
  const only = process.env.NETWORKS
    ? new Set(process.env.NETWORKS.split(",").map((s) => s.trim()).filter(Boolean))
    : undefined;
  const chains = listSafeChains(hre as never, only).filter((c) => c.rpcUrl);

  console.log(`\nv2 Safe: ${dep.address}`);
  dep.owners.forEach((o, i) => console.log(`  expected owner[${i}]: ${o}`));
  console.log(`chains: ${chains.length}\n`);

  let bad = 0;
  const rows = await mapLimit(chains, 4, async (chain) => {
    const problems: string[] = [];
    const out: Record<string, string> = { network: chain.network };
    try {
      const p = makeProvider(chain.rpcUrl, chain.chainId);
      const call = async (to: string, fn: string, args: unknown[] = []) =>
        IFACE.decodeFunctionResult(
          fn,
          await p.call({ to, data: IFACE.encodeFunctionData(fn, args) }),
        );

      const code = await p.getCode(dep.address);
      if (code === "0x") {
        out.status = "NOT DEPLOYED";
        return { out, problems: ["no bytecode at v2 address"] };
      }
      out.bytes = String((code.length - 2) / 2);

      const owners = ((await call(dep.address, "getOwners"))[0] as string[]).map(getAddress);
      const want = OKU_SAFE_V2_OWNERS.map((o) => getAddress(o));
      out.owners = `${owners.length}`;
      if (owners.length !== want.length || !want.every((w) => owners.includes(w))) {
        problems.push(`owner set mismatch: [${owners.join(", ")}]`);
      }
      // Order is not required by the contract, but a mismatch means the
      // deployed Safe was not produced by the initializer we think it was.
      out.order = JSON.stringify(owners) === JSON.stringify(want) ? "ok" : "DIFFERS";
      if (out.order === "DIFFERS") problems.push(`owner ORDER differs: [${owners.join(", ")}]`);

      const th = Number((await call(dep.address, "getThreshold"))[0]);
      out.thr = String(th);
      if (th !== OKU_SAFE_THRESHOLD) problems.push(`threshold ${th} != ${OKU_SAFE_THRESHOLD}`);

      out.version = String((await call(dep.address, "VERSION"))[0]);
      if (out.version !== "1.4.1") problems.push(`VERSION ${out.version}`);

      const n = Number((await call(dep.address, "nonce"))[0]);
      out.nonce = String(n);
      if (n !== 0) problems.push(`nonce ${n} != 0 -- Safe has already transacted`);

      const slot0 = await p.getStorage(dep.address, 0);
      const singleton = getAddress("0x" + slot0.slice(26));
      const wantSingleton =
        chain.chainId === 1 ? getAddress(SAFE_L1_SINGLETON) : getAddress(SAFE_L2_SINGLETON);
      out.singleton = singleton === wantSingleton ? "ok" : "WRONG";
      if (singleton !== wantSingleton) {
        problems.push(`singleton ${singleton}, expected ${wantSingleton}`);
      }

      const mods = (await call(dep.address, "getModulesPaginated", [SENTINEL, 10]))[0] as string[];
      out.modules = String(mods.length);
      if (mods.length !== 0) problems.push(`${mods.length} module(s) enabled: ${mods.join(", ")}`);

      // v1 must be untouched: it still holds ownership until the handover.
      const v1Owners = ((await call(OKU_SAFE_EXPECTED_ADDRESS, "getOwners"))[0] as string[]).map(
        (o) => getAddress(o),
      );
      const wantV1 = OKU_SAFE_OWNERS.map((o) => getAddress(o));
      out.v1 = JSON.stringify(v1Owners) === JSON.stringify(wantV1) ? "intact" : "CHANGED";
      if (out.v1 === "CHANGED") problems.push(`v1 owner set changed: [${v1Owners.join(", ")}]`);

      if (chain.router) {
        const ro = getAddress((await call(chain.router, "owner"))[0] as string);
        out.routerOwner =
          ro === getAddress(OKU_SAFE_EXPECTED_ADDRESS)
            ? "v1"
            : ro === getAddress(dep.address)
              ? "v2"
              : ro;
        if (out.routerOwner !== "v1") {
          problems.push(`router owner is ${out.routerOwner}, expected v1 at this stage`);
        }
      }
      out.status = problems.length ? "PROBLEM" : "ok";
    } catch (e) {
      out.status = "ERR";
      problems.push(`rpc: ${(e as Error).message.slice(0, 80)}`);
    }
    return { out, problems };
  });

  const pad = (s: string, n: number) => String(s ?? "").padEnd(n);
  console.log(
    pad("network", 12) + pad("status", 9) + pad("owners", 7) + pad("order", 7) +
      pad("thr", 5) + pad("ver", 7) + pad("nonce", 7) + pad("singleton", 11) +
      pad("mods", 6) + pad("v1", 9) + "routerOwner",
  );
  console.log("-".repeat(96));
  for (const { out, problems } of rows) {
    console.log(
      pad(out.network, 12) + pad(out.status, 9) + pad(out.owners, 7) + pad(out.order, 7) +
        pad(out.thr, 5) + pad(out.version, 7) + pad(out.nonce, 7) + pad(out.singleton, 11) +
        pad(out.modules, 6) + pad(out.v1, 9) + (out.routerOwner ?? ""),
    );
    if (problems.length) {
      bad++;
      problems.forEach((p) => console.log(`    ✗ ${p}`));
    }
  }
  console.log("-".repeat(96));
  console.log(bad === 0 ? `All ${rows.length} chain(s) verified clean.` : `${bad} chain(s) with problems.`);
  if (bad) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
