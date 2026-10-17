/**
 * safe:device-test
 *
 * Builds a throwaway bundle for finding out EXACTLY what each signer's
 * hardware wallet displays for a sweep, so the sign page and SIGNER-GUIDE.md
 * can mirror the real screens rather than assumptions.
 *
 * SAFETY: every payload's EIP-712 domain is chainId 31337 (local hardhat).
 * A Safe signature commits to its domain chainId, so nothing signed here can
 * be executed on any real chain, even though verifyingContract is the real
 * Safe address (kept so the device shows the same address it will show in a
 * real ceremony). Nothing is broadcast. The bundle is gitignored.
 *
 * Three sweep shapes, same calldata builder as safe:build:
 *   short   1 token        (what a nonzero chain often looks like)
 *   medium  hyperevm list  (30 tokens, a typical full list)
 *   long    base list      (300+ tokens; tests how a device pages ~10 KB of data)
 *
 * Usage:
 *   FORK_CHAIN_ID=31337 npx hardhat node              # terminal 1 (MetaMask needs a live RPC for 31337;
 *                                                     #  this repo's hardhat network defaults to chainId 10)
 *   npx hardhat safe:device-test                      # writes safe-bundles/device-test.json + WORKSHEET.md
 *   npm run sign-page                                 # open http://127.0.0.1:8547/device-test/sign.html
 */
import * as fs from "fs";
import * as path from "path";
import { task } from "hardhat/config";
import { TypedDataEncoder } from "ethers";
import { SAFE_TX_TYPES, buildBatchedSafeTx, hashSafeTx, safeDomain } from "../util/safeTx";
import { getOkuSafeDeployment, OKU_FEE_RECIPIENT } from "../util/safeConfig";
import { loadFeeTokens, sweepTokensFor } from "../util/feeTokens";
import { encodeSweepAll } from "../util/sweepCall";

const LOCAL_CHAIN_ID = 31337;
const BUNDLE_DIR = path.resolve(__dirname, "..", "safe-bundles");
const NAME = "device-test";
/** The production router address (same on most chains); only displayed. */
const ROUTER = "0xb1f3a7B816B0681188F54dFa400991B93ADf00ed";

task("safe:device-test", "Write a chainId-31337 sweep bundle for recording what each device displays").setAction(
  async () => {
    const dep = getOkuSafeDeployment();
    const ft = loadFeeTokens();
    const pick = (chainId: number) => sweepTokensFor(ft, chainId).tokens;
    const shapes = [
      { label: "short", tokens: pick(999).slice(0, 1) },
      { label: "medium", tokens: pick(999) },
      { label: "long", tokens: pick(8453) },
    ];
    const domain = safeDomain(LOCAL_CHAIN_ID, dep.address);

    const chains = shapes.map((s, i) => {
      const data = encodeSweepAll(
        s.tokens.map((t) => t.address),
        true,
        OKU_FEE_RECIPIENT,
      );
      const nonce = BigInt(i);
      const tx = buildBatchedSafeTx([{ to: ROUTER, data, value: 0n }], nonce);
      const safeTxHash = hashSafeTx(LOCAL_CHAIN_ID, dep.address, tx);
      return {
        network: `device-test-${s.label}`,
        chainId: LOCAL_CHAIN_ID,
        router: ROUTER,
        nonce: nonce.toString(),
        chainMeta: {
          chainName: "Hardhat local (device test — not a real chain)",
          rpcUrl: "http://127.0.0.1:8545",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
        calls: [{ to: ROUTER, data, value: "0", label: `device test ${s.label}` }],
        tx: {
          to: tx.to,
          value: tx.value.toString(),
          data: tx.data,
          operation: Number(tx.operation),
          safeTxGas: "0",
          baseGas: "0",
          gasPrice: "0",
          gasToken: tx.gasToken,
          refundReceiver: tx.refundReceiver,
          nonce: nonce.toString(),
        },
        safeTxHash,
        eip712: TypedDataEncoder.getPayload(domain, SAFE_TX_TYPES, tx),
        signatures: [],
        sweep: {
          recipient: OKU_FEE_RECIPIENT,
          includeEth: true,
          assets: [],
          usdNotional: 0,
          unpricedCount: 0,
          mode: "full" as const,
          modeReason: `device test (${s.label})`,
          tokens: s.tokens.map((t) => ({ token: t.address, symbol: t.symbol })),
        },
        domainHash: TypedDataEncoder.hashDomain(domain),
        messageHash: TypedDataEncoder.from(SAFE_TX_TYPES).hash(tx),
        dataBytes: (data.length - 2) / 2,
      };
    });

    const bundle = {
      name: NAME,
      intent: "sweep",
      params: { recipient: OKU_FEE_RECIPIENT, to: OKU_FEE_RECIPIENT, deviceTest: true },
      safe: dep.address,
      threshold: dep.threshold,
      owners: [...dep.owners],
      createdAt: new Date().toISOString(),
      chains,
    };
    fs.writeFileSync(path.join(BUNDLE_DIR, `${NAME}.json`), JSON.stringify(bundle, null, 2) + "\n");

    const dir = path.join(BUNDLE_DIR, NAME);
    fs.mkdirSync(dir, { recursive: true });
    const ws: string[] = [
      `# Device display worksheet (${new Date().toISOString().slice(0, 10)})`,
      "",
      "chainId 31337 only — these signatures cannot execute anywhere. Sign each row from",
      "http://127.0.0.1:8547/device-test/sign.html with EACH wallet path, and record what",
      "the device shows. Send this file back filled in.",
      "",
      "Wallet paths: (A) Ledger via MetaMask  (B) Ledger via Rabby  (C) Trezor via MetaMask",
      "",
    ];
    for (const c of chains) {
      ws.push(
        `## ${c.network}: ${c.sweep.tokens.length} token(s), data ${c.dataBytes} bytes, nonce ${c.nonce}`,
        "",
        "Expected (from the page's review card):",
        "",
        `- domain: chainId 31337, verifyingContract ${dep.address}`,
        `- to ${ROUTER}, value 0, operation 0, safeTxGas/baseGas/gasPrice 0, gasToken/refundReceiver 0x0, nonce ${c.nonce}`,
        `- data starts ${c.tx.data.slice(0, 74)}`,
        `- domain hash  ${c.domainHash}`,
        `- message hash ${c.messageHash}`,
        `- safeTxHash   ${c.safeTxHash}`,
        "",
        "| question | A Ledger/MetaMask | B Ledger/Rabby | C Trezor/MetaMask |",
        "|---|---|---|---|",
        "| fields shown one by one, or only hashes? | | | |",
        "| field order as listed above? | | | |",
        "| how is `data` shown (full / truncated / paged / hash only)? | | | |",
        "| number of screens to get through `data` | | | |",
        "| domain hash / message hash shown? match the card? | | | |",
        "| any warning text (blind signing, unknown chain, ...)? | | | |",
        "| signature saved ✓ on the page? | | | |",
        "",
      );
    }
    fs.writeFileSync(path.join(dir, "WORKSHEET.md"), ws.join("\n"));

    console.log(`\nWrote safe-bundles/${NAME}.json (${chains.length} payloads, chainId ${LOCAL_CHAIN_ID})`);
    console.log(`Wrote safe-bundles/${NAME}/WORKSHEET.md`);
    for (const c of chains) {
      console.log(`  ${c.network.padEnd(20)} ${String(c.sweep.tokens.length).padStart(4)} tokens  ${String(c.dataBytes).padStart(6)} bytes  ${c.safeTxHash}`);
    }
    console.log(`\nNext:\n  1. FORK_CHAIN_ID=31337 npx hardhat node   (separate terminal)\n  2. npm run sign-page\n  3. open http://127.0.0.1:8547/${NAME}/sign.html and follow WORKSHEET.md\n`);
  },
);
