/**
 * testForkSwapTargets.ts
 *
 * Fork rehearsal of a `swap-targets` Safe bundle, before any signature is
 * collected. For every chain in the bundle it:
 *
 *   1. Forks the real chain at its latest block, with the EVM reporting the
 *      real chainId (FORK_CHAIN_ID), so the SafeTx EIP-712 domain -- and hence
 *      the safeTxHash -- is the one the hardware wallets will actually sign.
 *   2. Asserts the premise: router.owner() is the Safe, the Safe's live nonce
 *      equals the bundle nonce, and the Safe's own getTransactionHash() over
 *      the bundle's stored fields equals the bundle's safeTxHash.
 *   3. Asserts every target in the bundle currently reads swapTargets == false.
 *   4. Executes the REAL Safe path rather than impersonating the Safe: two
 *      current owners are impersonated and each calls approveHash(safeTxHash);
 *      an unrelated relayer then calls execTransaction with the bundle's exact
 *      fields and pre-validated (v=1) signatures. This exercises threshold
 *      enforcement, the nonce, the MultiSendCallOnly delegatecall where the
 *      bundle batches, and the router's onlyOwner gate end to end.
 *   5. Asserts ExecutionSuccess was emitted, the Safe nonce advanced by one,
 *      every bundled target now reads true, and every address previously
 *      whitelisted in chain-config for that chain is still true (the bundle
 *      must be strictly additive).
 *
 * Usage:
 *   BUNDLE=<name> npx hardhat run scripts/testForkSwapTargets.ts
 *       -> spawns one child process per chain in the bundle (FORK_CHAIN_ID
 *          can only be set per process) and prints a summary.
 *   BUNDLE=<name> SWAP_NETWORK=<net> FORK_CHAIN_ID=<id> npx hardhat run ...
 *       -> rehearses that single chain.
 *
 * Env:
 *   BUNDLE         bundle name in safe-bundles/ (required)
 *   SWAP_NETWORK   restrict to one network (child mode)
 *   ONLY           comma-separated subset of networks (parent mode)
 *   <NET>_URL      the usual hardhat.config RPC overrides apply
 */
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import hre from "hardhat";
import { Interface, getAddress, parseEther, toBeHex, zeroPadValue, concat } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { NETWORK_CONFIGS } from "../util/deploymentConfig";

const BUNDLE_DIR = path.resolve(__dirname, "..", "safe-bundles");

const ROUTER = new Interface([
  "function owner() view returns (address)",
  "function swapTargets(address) view returns (bool)",
  "function updateSwapTargets(address,bool)",
]);
const SAFE = new Interface([
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function approveHash(bytes32)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)",
  "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns (bool)",
  "event ExecutionSuccess(bytes32 txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 txHash, uint256 payment)",
]);
const MULTISEND = new Interface(["function multiSend(bytes)"]);

interface BundleCall { to: string; data: string; value: string; label: string }
interface BundleChain {
  network: string;
  chainId: number;
  router: string;
  nonce: string;
  calls: BundleCall[];
  tx: {
    to: string; value: string; data: string; operation: number;
    safeTxGas: string; baseGas: string; gasPrice: string;
    gasToken: string; refundReceiver: string; nonce: string;
  };
  safeTxHash: string;
}

function loadBundle(name: string) {
  const p = path.join(BUNDLE_DIR, `${name}.json`);
  if (!fs.existsSync(p)) throw new Error(`bundle not found: ${p}`);
  const b = JSON.parse(fs.readFileSync(p, "utf8"));
  if (b.intent !== "swap-targets") throw new Error(`bundle ${name} intent is "${b.intent}", expected "swap-targets"`);
  return b as { name: string; safe: string; threshold: number; owners: string[]; chains: BundleChain[] };
}

/** Targets the bundle sets to true, decoded from calldata rather than labels. */
function bundledTargets(chain: BundleChain): string[] {
  const out: string[] = [];
  for (const c of chain.calls) {
    if (getAddress(c.to) !== getAddress(chain.router)) throw new Error(`call to ${c.to} is not the router`);
    if (BigInt(c.value) !== 0n) throw new Error(`call carries value ${c.value}`);
    const [target, add] = ROUTER.decodeFunctionData("updateSwapTargets", c.data);
    if (add !== true) throw new Error(`call sets ${target} to ${add}; this rehearsal expects additions only`);
    out.push(getAddress(target));
  }
  // The signed tx must encode exactly these calls.
  if (chain.tx.operation === 0) {
    if (chain.calls.length !== 1 || chain.tx.data !== chain.calls[0].data || getAddress(chain.tx.to) !== getAddress(chain.router)) {
      throw new Error("single-call tx does not match its call entry");
    }
  } else {
    const packed: string = MULTISEND.decodeFunctionData("multiSend", chain.tx.data)[0];
    const raw = packed.slice(2);
    const inner: string[] = [];
    let i = 0;
    while (i < raw.length) {
      const op = parseInt(raw.slice(i, i + 2), 16);
      const to = getAddress("0x" + raw.slice(i + 2, i + 42));
      const len = parseInt(raw.slice(i + 106, i + 170), 16);
      const data = "0x" + raw.slice(i + 170, i + 170 + len * 2);
      if (op !== 0 || to !== getAddress(chain.router)) throw new Error(`multisend entry op=${op} to=${to}`);
      inner.push(data);
      i += 170 + len * 2;
    }
    if (inner.length !== chain.calls.length || inner.some((d, k) => d !== chain.calls[k].data)) {
      throw new Error("multisend payload does not match the bundle's call list");
    }
  }
  return out;
}

async function call(provider: JsonRpcProvider, iface: Interface, to: string, fn: string, args: unknown[] = []) {
  const ret = await provider.call({ to, data: iface.encodeFunctionData(fn, args) });
  return iface.decodeFunctionResult(fn, ret);
}

async function rehearseOne(bundleName: string, network: string) {
  const bundle = loadBundle(bundleName);
  const chain = bundle.chains.find((c) => c.network === network);
  if (!chain) throw new Error(`bundle has no chain ${network}`);
  const safe = getAddress(bundle.safe);
  const router = getAddress(chain.router);
  const targets = bundledTargets(chain);

  const forkRpc = (hre.config.networks as Record<string, { url?: string }>)[network]?.url;
  if (!forkRpc) throw new Error(`no RPC for ${network}`);

  await hre.network.provider.request({ method: "hardhat_reset", params: [{ forking: { jsonRpcUrl: forkRpc } }] });
  const provider = hre.ethers.provider as unknown as JsonRpcProvider;
  const evmChainId = Number((await provider.getNetwork()).chainId);
  const block = await provider.getBlockNumber();
  console.log(`[${network}] forked at block ${block}, chainId ${evmChainId}`);
  if (evmChainId !== chain.chainId) throw new Error(`EVM chainId ${evmChainId} != ${chain.chainId}; set FORK_CHAIN_ID`);

  // ---- premise --------------------------------------------------------------
  const [owner] = await call(provider, ROUTER, router, "owner");
  if (getAddress(owner) !== safe) throw new Error(`router owner ${owner} is not the Safe`);
  const [nonce] = await call(provider, SAFE, safe, "nonce");
  if (nonce.toString() !== chain.nonce) throw new Error(`Safe nonce ${nonce} != bundle nonce ${chain.nonce} (stale bundle)`);
  const t = chain.tx;
  const txArgs = [t.to, t.value, t.data, t.operation, t.safeTxGas, t.baseGas, t.gasPrice, t.gasToken, t.refundReceiver];
  const [hash] = await call(provider, SAFE, safe, "getTransactionHash", [...txArgs, t.nonce]);
  if (hash !== chain.safeTxHash) throw new Error(`getTransactionHash ${hash} != bundle ${chain.safeTxHash}`);
  const [owners] = await call(provider, SAFE, safe, "getOwners");
  const [threshold] = await call(provider, SAFE, safe, "getThreshold");

  for (const a of targets) {
    const [on] = await call(provider, ROUTER, router, "swapTargets", [a]);
    if (on) throw new Error(`${a} is already whitelisted; bundle would be a no-op for it`);
  }
  // Every other configured target that is currently on must stay on.
  const cfg = NETWORK_CONFIGS[network];
  const preexisting: string[] = [];
  for (const k of cfg?.knownSwapTargets ?? []) {
    const a = getAddress(k.address);
    if (targets.includes(a)) continue;
    const [on] = await call(provider, ROUTER, router, "swapTargets", [a]);
    if (on) preexisting.push(a);
  }

  // ---- execute through the real Safe path -----------------------------------
  const approvers = (owners as string[]).map(getAddress).slice(0, Number(threshold));
  for (const o of approvers) {
    await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [o] });
    await hre.network.provider.request({ method: "hardhat_setBalance", params: [o, toBeHex(parseEther("100000"))] });
    const s = await hre.ethers.getSigner(o);
    const rc = await (await s.sendTransaction({ to: safe, data: SAFE.encodeFunctionData("approveHash", [hash]) })).wait();
    if (rc?.status !== 1) throw new Error(`approveHash by ${o} failed`);
    await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [o] });
  }
  // Pre-validated signatures (v=1, r=owner), sorted ascending by owner.
  const sigs = concat(
    [...approvers]
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
      .map((o) => concat([zeroPadValue(o, 32), zeroPadValue("0x", 32), "0x01"])),
  );
  const [relayer] = await hre.ethers.getSigners();
  await hre.network.provider.request({ method: "hardhat_setBalance", params: [relayer.address, toBeHex(parseEther("100000"))] });
  const exec = await relayer.sendTransaction({ to: safe, data: SAFE.encodeFunctionData("execTransaction", [...txArgs, sigs]) });
  const rc = await exec.wait();
  if (rc?.status !== 1) throw new Error("execTransaction reverted");
  // Matched by topic, not parseLog: Safe v1.4.1 indexes txHash, earlier
  // versions do not, and the topic hash is identical either way.
  const okTopic = SAFE.getEvent("ExecutionSuccess")!.topicHash;
  const failTopic = SAFE.getEvent("ExecutionFailure")!.topicHash;
  let success = false;
  for (const log of rc.logs) {
    if (getAddress(log.address) !== safe) continue;
    if (log.topics[0] === failTopic) throw new Error("Safe emitted ExecutionFailure (inner call reverted)");
    if (log.topics[0] === okTopic) {
      const logged = log.topics.length > 1 ? log.topics[1] : log.data.slice(0, 66);
      if (logged.toLowerCase() === String(hash).toLowerCase()) success = true;
    }
  }
  if (!success) throw new Error("no ExecutionSuccess for this safeTxHash");

  // ---- post-state ------------------------------------------------------------
  const [nonceAfter] = await call(provider, SAFE, safe, "nonce");
  if (nonceAfter !== nonce + 1n) throw new Error(`nonce ${nonce} -> ${nonceAfter}, expected +1`);
  for (const a of targets) {
    const [on] = await call(provider, ROUTER, router, "swapTargets", [a]);
    if (!on) throw new Error(`${a} still false after execution`);
  }
  for (const a of preexisting) {
    const [on] = await call(provider, ROUTER, router, "swapTargets", [a]);
    if (!on) throw new Error(`pre-existing target ${a} was turned off`);
  }
  console.log(
    `[${network}] PASS  nonce ${nonce}->${nonceAfter}  gasUsed ${rc.gasUsed}  ` +
      `+${targets.length} target(s) [${targets.join(", ")}]  ${preexisting.length} pre-existing intact`,
  );
}

async function main() {
  const bundleName = process.env.BUNDLE;
  if (!bundleName) throw new Error("set BUNDLE=<name>");

  if (process.env.SWAP_NETWORK) {
    await rehearseOne(bundleName, process.env.SWAP_NETWORK);
    return;
  }

  // Parent mode: one child per chain, since FORK_CHAIN_ID is fixed per process.
  const bundle = loadBundle(bundleName);
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim())) : undefined;
  const results: { network: string; ok: boolean; tail: string }[] = [];
  for (const c of bundle.chains) {
    if (only && !only.has(c.network)) continue;
    const r = spawnSync("npx", ["hardhat", "run", __filename], {
      env: { ...process.env, SWAP_NETWORK: c.network, FORK_CHAIN_ID: String(c.chainId) },
      encoding: "utf8",
      timeout: 300_000,
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    const ok = r.status === 0 && /\] PASS /.test(out);
    const lines = out.split("\n").filter(Boolean);
    const tail = ok ? lines.find((l) => l.includes("] PASS ")) ?? "" : lines.slice(-6).join("\n    ");
    console.log(ok ? tail : `[${c.network}] FAIL\n    ${tail}`);
    results.push({ network: c.network, ok, tail });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} chain(s) passed.`);
  if (failed.length) {
    console.log(`failed: ${failed.map((f) => f.network).join(",")}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
