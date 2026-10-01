/**
 * verifyBundleHashes.ts
 *
 * Re-derives every safeTxHash in a bundle three independent ways and checks
 * it against live chain state:
 *
 *   1. as recorded in the bundle JSON
 *   2. as computed by the Safe itself via getTransactionHash()
 *   3. as recomputed locally from the bundle's own EIP-712 payload
 *
 * All three must agree. (2) proves the hash matches what the contract will
 * check at execution time; (3) proves the EIP-712 blob a signer's wallet
 * renders corresponds to that same hash -- a bundle whose displayed payload
 * and signed hash disagree is exactly how a signer gets tricked.
 *
 * Also verifies each chain's bundle nonce still equals the Safe's live nonce,
 * since a nonce advance silently invalidates every signature collected.
 *
 * Usage: BUNDLE=<name> npx hardhat run scripts/verifyBundleHashes.ts
 */
import * as fs from "fs";
import hre from "hardhat";
import { Interface, TypedDataEncoder, getAddress } from "ethers";
import { listSafeChains, makeProvider, mapLimit } from "../util/safeChains";

const SAFE_IFACE = new Interface([
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);

async function main() {
  const name = process.env.BUNDLE;
  if (!name) throw new Error("set BUNDLE=<bundle name>");
  const bundle = JSON.parse(fs.readFileSync(`safe-bundles/${name}.json`, "utf8"));

  const chains = listSafeChains(hre as never);
  const byNet = new Map(chains.map((c) => [c.network, c]));

  console.log(`\nbundle: ${bundle.name}   safe: ${bundle.safe}   chains: ${bundle.chains.length}\n`);

  let bad = 0;
  const rows = await mapLimit(bundle.chains as Record<string, never>[], 4, async (ch) => {
    const problems: string[] = [];
    const network = String(ch.network);
    const meta = byNet.get(network);
    if (!meta || !meta.rpcUrl) return { network, onchain: "?", local: "?", nonce: "?", owners: "?", problems: ["no rpc"] };

    const out = { network, onchain: "?", local: "?", nonce: "?", owners: "?", problems };
    try {
      const p = makeProvider(meta.rpcUrl, Number(ch.chainId));
      const t = ch.tx as Record<string, never>;

      const raw = await p.call({
        to: bundle.safe,
        data: SAFE_IFACE.encodeFunctionData("getTransactionHash", [
          t.to, t.value, t.data, t.operation, t.safeTxGas,
          t.baseGas, t.gasPrice, t.gasToken, t.refundReceiver, t.nonce,
        ]),
      });
      const onchain = String(SAFE_IFACE.decodeFunctionResult("getTransactionHash", raw)[0]);
      out.onchain = onchain.toLowerCase() === String(ch.safeTxHash).toLowerCase() ? "match" : "MISMATCH";
      if (out.onchain !== "match") problems.push(`on-chain hash ${onchain} != bundle ${ch.safeTxHash}`);

      const e = ch.eip712 as unknown as {
        domain: { chainId: string; verifyingContract: string };
        types: { SafeTx: unknown[] };
        message: Record<string, unknown>;
      };
      const local = TypedDataEncoder.hash(
        { chainId: BigInt(e.domain.chainId), verifyingContract: e.domain.verifyingContract },
        { SafeTx: e.types.SafeTx as never },
        e.message as never,
      );
      out.local = local.toLowerCase() === String(ch.safeTxHash).toLowerCase() ? "match" : "MISMATCH";
      if (out.local !== "match") problems.push(`eip712 recompute ${local} != bundle`);

      const liveNonce = SAFE_IFACE.decodeFunctionResult(
        "nonce",
        await p.call({ to: bundle.safe, data: SAFE_IFACE.encodeFunctionData("nonce") }),
      )[0] as bigint;
      out.nonce = String(liveNonce) === String(ch.nonce) ? `ok(${ch.nonce})` : `STALE ${liveNonce}!=${ch.nonce}`;
      if (!out.nonce.startsWith("ok")) problems.push(`nonce drifted: live ${liveNonce}, bundle ${ch.nonce}`);

      // The signers listed in the bundle must still be the Safe's owners,
      // and the threshold must still be what the bundle assumed.
      const owners = (SAFE_IFACE.decodeFunctionResult(
        "getOwners",
        await p.call({ to: bundle.safe, data: SAFE_IFACE.encodeFunctionData("getOwners") }),
      )[0] as string[]).map((o) => getAddress(o)).sort().join(",");
      const want = (bundle.owners as string[]).map((o) => getAddress(o)).sort().join(",");
      const th = Number(SAFE_IFACE.decodeFunctionResult(
        "getThreshold",
        await p.call({ to: bundle.safe, data: SAFE_IFACE.encodeFunctionData("getThreshold") }),
      )[0]);
      out.owners = owners === want && th === bundle.threshold ? "ok" : "DRIFT";
      if (out.owners !== "ok") problems.push(`owner/threshold drift: live [${owners}] thr ${th}`);
    } catch (err) {
      problems.push(`rpc: ${(err as Error).message.slice(0, 70)}`);
    }
    return out;
  });

  const pad = (s: string, n: number) => String(s ?? "").padEnd(n);
  console.log(pad("network", 12) + pad("onchainHash", 13) + pad("eip712Hash", 12) + pad("nonce", 14) + "owners/thr");
  console.log("-".repeat(64));
  for (const r of rows) {
    console.log(pad(r.network, 12) + pad(r.onchain, 13) + pad(r.local, 12) + pad(r.nonce, 14) + r.owners);
    if (r.problems.length) { bad++; r.problems.forEach((p) => console.log(`    x ${p}`)); }
  }
  console.log("-".repeat(64));
  console.log(bad === 0
    ? `All ${rows.length} chain(s): hash verified 3 ways, nonce live, owner set current.`
    : `${bad} chain(s) with problems.`);
  if (bad) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
