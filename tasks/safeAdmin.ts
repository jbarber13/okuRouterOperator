/**
 * safeAdmin.ts
 *
 * Three-stage admin flow for driving 34 OkuRouters from one Safe.
 *
 *   safe:build  -- diff desired vs on-chain state, emit one SafeTx per chain
 *                  into a bundle file. Verifies every safeTxHash against the
 *                  Safe's own getTransactionHash() before anyone signs.
 *   safe:sign   -- attach signatures to a bundle (local key, or import
 *                  signatures produced by an external hardware-wallet tool).
 *   safe:exec   -- merge signatures and broadcast execTransaction on every
 *                  chain from the hot deployer EOA.
 *   safe:status -- per-chain Safe + router state at a glance.
 *
 * Why this exists
 * ---------------
 * `execTransaction` is permissionless: once `threshold` signatures exist,
 * ANY address can broadcast it. That is the single most useful property for
 * our situation. It means the hot deployer EOA can relay and pay gas on all
 * 34 chains while holding zero authority, and our hardware wallets never need
 * a gas balance anywhere.
 *
 * By contrast a Safe *Proposer* (delegate) cannot sign and cannot execute --
 * it only pre-fills the Safe{Wallet} queue, and only on the 22 chains that
 * have a hosted Transaction Service. It is a UI convenience, not a throughput
 * mechanism. These tasks deliberately do not depend on it.
 *
 * Signature collection is the one step that cannot be collapsed: chainId is
 * inside the SafeTx EIP-712 domain and the nonce is per-chain, so each chain
 * needs its own signature from each signer. There is no stock-Safe way around
 * that. Practical routes, both supported here:
 *   - the 22 tx-service chains: owners sign in app.safe.global with their
 *     hardware wallet, then `safe:exec --from-service` pulls the collected
 *     signatures and relays so the owners never pay gas.
 *   - all 34 chains: `safe:build` writes EIP-712 payloads that safe-cli
 *     (`--trezor` / `--ledger`) or any offline signer can consume, and
 *     `safe:sign --import` folds the results back in.
 *
 * Bundles are bearer authorizations -- anyone holding a bundle with
 * `threshold` signatures can execute it. safe-bundles/ is gitignored.
 */
import * as fs from "fs";
import * as path from "path";
import { task } from "hardhat/config";
import { TypedDataEncoder, Wallet, ZeroAddress, formatUnits, getAddress } from "ethers";
import type { JsonRpcProvider } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  OKU_DEPLOYER_EOA,
  SAFE_MULTISEND_CALL_ONLY,
  assertOkuSafeConfig,
  getOkuSafeDeployment,
  hasSafeTxService,
  safeTxServiceUrl,
} from "../util/safeConfig";
import {
  SAFE_IFACE,
  SAFE_TX_TYPES,
  SafeOperation,
  buildBatchedSafeTx,
  decodeRevert,
  hashSafeTx,
  packSignatures,
  recoverSafeTxSigner,
  safeDomain,
  verifySafeTxHashOnChain,
  type SafeTransactionData,
} from "../util/safeTx";
import {
  confirmTx,
  gasOverrides,
  listSafeChains,
  makeProvider,
  mapLimit,
  pad,
  resolveDeployerKey,
  type SafeChain,
} from "../util/safeChains";
import { withRetry } from "../util/rpcRetry";
import { NETWORK_CONFIGS, type SwapTarget } from "../util/deploymentConfig";
import { MAINNET_CHAINS } from "@gfxlabs/oku-chains";
import { OkuRouter__factory } from "../typechain-types";
import {
  NATIVE_SENTINEL,
  fmtAmount,
  priceAssets,
  readNonZeroBalances,
  scanChainFees,
  totalUsd,
  type PricedFeeAsset,
} from "../util/feeScan";
import { _internal as universeInternal } from "../util/tokenUniverse";
import {
  chooseSweepMode,
  loadFeeTokens,
  sortTokens,
  sweepTokensFor,
  type FeeTokensFile,
  type ModeDecision,
  type SweepMode,
} from "../util/feeTokens";
import {
  decodeSweepAll,
  encodeSweepAll,
  estimateSweepGas,
  sweepGasCap,
} from "../util/sweepCall";
import { readSnapshot, type SnapshotAsset } from "../util/feeSnapshot";
import { OKU_FEE_RECIPIENT } from "../util/safeConfig";
import { accountForSweepTx, writeAccounting } from "./feeAccounting";

const BUNDLE_DIR = path.resolve(__dirname, "..", "safe-bundles");
const ROUTER_IFACE = OkuRouter__factory.createInterface();

/** Supported build intents. */
type Intent =
  | "accept-ownership"
  | "transfer-ownership"
  | "pause"
  | "unpause"
  | "swap-targets"
  | "valid-signer"
  | "max-warrant-duration"
  | "sweep";

/**
 * Per-asset record pinned into a sweep bundle's `params`.
 *
 * This is the audit trail and the signer-facing manifest in one. The sign
 * page renders it directly (buildPage.js ships the whole bundle minus
 * signatures), because a 32-token sweep collapses into a single unreadable
 * line if the only description is the call label.
 *
 * Balances here are a snapshot from build time. `sweepAll` always moves the
 * FULL balance at execution time, so actual amounts will be >= these. The
 * accounting artifact records what actually moved.
 */
interface SweepAssetSnapshot {
  token: string;
  symbol: string;
  decimals: number;
  amountRaw: string;
  amount: string;
  /** Firm valuation (counted in totals). */
  usdValue?: number;
  /** Thin valuation (shown, never counted). */
  usdValueThin?: number;
  priceSource?: string;
}

interface BundleCall {
  to: string;
  data: string;
  value: string;
  /** Human-readable description, shown at sign-off time. */
  label: string;
}

/**
 * Wallet-facing chain metadata, embedded so the offline signing page can
 * call `wallet_addEthereumChain` for networks the signer's wallet has never
 * seen (Gensyn, Saga, Redbelly, ...).
 *
 * This is not cosmetic: `eth_signTypedData_v4` is rejected by MetaMask unless
 * the active network matches the SafeTx domain's chainId, so the page must be
 * able to switch to -- and therefore possibly add -- every chain in a bundle.
 */
interface BundleChainMeta {
  chainName: string;
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrl?: string;
}

interface BundleChain {
  network: string;
  chainId: number;
  router: string;
  nonce: string;
  chainMeta?: BundleChainMeta;
  calls: BundleCall[];
  tx: {
    to: string;
    value: string;
    data: string;
    operation: number;
    safeTxGas: string;
    baseGas: string;
    gasPrice: string;
    gasToken: string;
    refundReceiver: string;
    nonce: string;
  };
  safeTxHash: string;
  /** EIP-712 payload, for external/hardware signers. */
  eip712: unknown;
  signatures: { signer: string; signature: string }[];
  /**
   * Owners known to have signed already. Present only in the copy embedded
   * into a distributed sign.html, where signature bytes are stripped -- it
   * lets the page grey out completed rows without carrying authorization
   * material.
   */
  signedBy?: string[];
  note?: string;
  /**
   * Itemized fund-movement manifest, present only on `sweep` bundles.
   * Rendered by the signing page so a signer approving a 32-token sweep can
   * see every asset and the recipient, rather than one truncated call label.
   */
  sweep?: {
    recipient: string;
    includeEth: boolean;
    assets: SweepAssetSnapshot[];
    usdNotional: number;
    /** Assets in this manifest carrying no USD value; they contribute $0. */
    unpricedCount: number;
    /** Thin-priced assets: shown, not in usdNotional. */
    thinUsd?: number;
    thinCount?: number;
    /** Which token list went into the calldata, and why. Absent on pre-2026-10-17 bundles. */
    mode?: "full" | "nonzero";
    modeReason?: string;
    /** USD cost of the zero-balance entries in a full list, at build time. */
    extraUsd?: number | null;
    gasEstimate?: string;
    /** The calldata token array in order, with symbols, for the sign page. */
    tokens?: { token: string; symbol: string }[];
  };
}

interface Bundle {
  name: string;
  intent: Intent;
  params: Record<string, unknown>;
  safe: string;
  threshold: number;
  owners: string[];
  createdAt: string;
  chains: BundleChain[];
}

function serializeTx(tx: SafeTransactionData) {
  return {
    to: tx.to,
    value: tx.value.toString(),
    data: tx.data,
    operation: Number(tx.operation),
    safeTxGas: tx.safeTxGas.toString(),
    baseGas: tx.baseGas.toString(),
    gasPrice: tx.gasPrice.toString(),
    gasToken: tx.gasToken,
    refundReceiver: tx.refundReceiver,
    nonce: tx.nonce.toString(),
  };
}

function deserializeTx(t: BundleChain["tx"]): SafeTransactionData {
  return {
    to: getAddress(t.to),
    value: BigInt(t.value),
    data: t.data,
    operation: t.operation as SafeOperation,
    safeTxGas: BigInt(t.safeTxGas),
    baseGas: BigInt(t.baseGas),
    gasPrice: BigInt(t.gasPrice),
    gasToken: getAddress(t.gasToken),
    refundReceiver: getAddress(t.refundReceiver),
    nonce: BigInt(t.nonce),
  };
}

/**
 * Resolve an intent into the concrete calls for one chain.
 *
 * Returns an empty array when the chain is already in the desired state, so
 * the bundle only contains chains that actually need work -- a no-op SafeTx
 * would still burn a nonce and a signing ceremony.
 */
async function callsForIntent(
  intent: Intent,
  params: Record<string, unknown>,
  chain: SafeChain,
  provider: JsonRpcProvider,
  safeAddress: string,
): Promise<{ calls: BundleCall[]; note?: string }> {
  const router = OkuRouter__factory.connect(chain.router!, provider);

  switch (intent) {
    case "accept-ownership": {
      const [owner, pending] = await Promise.all([router.owner(), router.pendingOwner()]);
      if (getAddress(owner) === getAddress(safeAddress)) {
        return { calls: [], note: "Safe already owns this router" };
      }
      if (getAddress(pending) !== getAddress(safeAddress)) {
        return {
          calls: [],
          note:
            `pendingOwner is ${getAddress(pending)}, not the Safe. Run ` +
            `\`safe:handover --broadcast\` first (transferOwnership is an EOA tx).`,
        };
      }
      return {
        calls: [
          {
            to: chain.router!,
            data: ROUTER_IFACE.encodeFunctionData("acceptOwnership"),
            value: "0",
            label: `acceptOwnership() -- Safe takes ownership of OkuRouter ${chain.router}`,
          },
        ],
      };
    }

    case "transfer-ownership": {
      // Step 1 of the Ownable2Step handover, authorized by the CURRENT owner
      // (the v1 Safe). This only sets pendingOwner -- the current Safe keeps
      // full control until the new Safe executes acceptOwnership(), so a
      // mistake here is recoverable by simply transferring again.
      //
      // Note this is NOT `safe:handover`, which does the same call from a
      // local EOA key and cannot act on behalf of a Safe.
      const newOwner = getAddress(String(params.to));
      const [owner, pending] = await Promise.all([router.owner(), router.pendingOwner()]);

      if (getAddress(owner) !== getAddress(safeAddress)) {
        return {
          calls: [],
          note: `router owner is ${getAddress(owner)}, not this Safe -- cannot transfer`,
        };
      }
      if (getAddress(owner) === newOwner) {
        return { calls: [], note: "router is already owned by the target" };
      }
      if (getAddress(pending) === newOwner) {
        return { calls: [], note: "pendingOwner is already the target -- awaiting accept" };
      }
      // A swap target getting it wrong costs a whitelist entry; getting THIS
      // wrong hands the router to an address nobody controls. The destination
      // must be a live contract, and it must answer as a Safe with the
      // threshold we expect -- an EOA or an unrelated contract is refused.
      const code = await provider.getCode(newOwner);
      if (code === "0x") {
        return { calls: [], note: `REFUSED: ${newOwner} has no bytecode on this chain` };
      }
      try {
        const got = await provider.call({
          to: newOwner,
          data: SAFE_IFACE.encodeFunctionData("getThreshold"),
        });
        const th = Number(SAFE_IFACE.decodeFunctionResult("getThreshold", got)[0]);
        if (th < 1) {
          return { calls: [], note: `REFUSED: ${newOwner} reports threshold ${th}` };
        }
      } catch {
        return {
          calls: [],
          note: `REFUSED: ${newOwner} does not answer getThreshold() -- not a Safe`,
        };
      }
      if (getAddress(pending) !== getAddress(ZeroAddress)) {
        // Not fatal (transferOwnership overwrites it), but the operator
        // should know they are redirecting an in-flight handover.
        console.log(
          `  ⚠ ${chain.network}: pendingOwner is currently ${getAddress(pending)}; ` +
            `this call replaces it with ${newOwner}`,
        );
      }
      return {
        calls: [
          {
            to: chain.router!,
            data: ROUTER_IFACE.encodeFunctionData("transferOwnership", [newOwner]),
            value: "0",
            label:
              `transferOwnership(${newOwner}) -- sets pendingOwner on OkuRouter ` +
              `${chain.router}; ownership does NOT move until the new Safe accepts`,
          },
        ],
      };
    }

    case "pause":
    case "unpause": {
      const paused = await router.paused();
      if (intent === "pause" && paused) return { calls: [], note: "already paused" };
      if (intent === "unpause" && !paused) return { calls: [], note: "already unpaused" };
      return {
        calls: [
          {
            to: chain.router!,
            // Branch explicitly: typechain's generated Interface is typed on
            // literal function names, so a "pause" | "unpause" union is not
            // assignable to encodeFunctionData.
            data:
              intent === "pause"
                ? ROUTER_IFACE.encodeFunctionData("pause")
                : ROUTER_IFACE.encodeFunctionData("unpause"),
            value: "0",
            label: `${intent}() on OkuRouter ${chain.router}`,
          },
        ],
      };
    }

    case "swap-targets": {
      const cfg = NETWORK_CONFIGS[chain.network];
      if (!cfg) return { calls: [], note: "NO_NETWORK_CONFIG" };
      const targets: readonly SwapTarget[] = cfg.knownSwapTargets;
      if (targets.length === 0) return { calls: [], note: "NO_TARGETS_IN_CHAIN_CONFIG" };

      const calls: BundleCall[] = [];
      const skipped: string[] = [];
      for (const t of targets) {
        if (await router.swapTargets(t.address)) continue;
        // Never whitelist an address with no bytecode: a swap target receives
        // ERC20 approvals and arbitrary calls from the router.
        const code = await provider.getCode(t.address);
        if (code === "0x") {
          skipped.push(`${t.name} (no code)`);
          continue;
        }
        calls.push({
          to: chain.router!,
          data: ROUTER_IFACE.encodeFunctionData("updateSwapTargets", [t.address, true]),
          value: "0",
          label: `updateSwapTargets(${t.address}, true)  ${t.name} [${t.protocol}]`,
        });
      }
      return {
        calls,
        note: skipped.length ? `skipped: ${skipped.join(", ")}` : undefined,
      };
    }

    case "valid-signer": {
      const signer = getAddress(String(params.address));
      const add = Boolean(params.add);
      const current = await router.validSigners(signer);
      if (current === add) return { calls: [], note: `already ${add ? "valid" : "invalid"}` };
      return {
        calls: [
          {
            to: chain.router!,
            data: ROUTER_IFACE.encodeFunctionData("updateValidSigner", [signer, add]),
            value: "0",
            label: `updateValidSigner(${signer}, ${add})`,
          },
        ],
      };
    }

    case "max-warrant-duration": {
      const seconds = BigInt(String(params.seconds));
      const current = await router.maxWarrantDuration();
      if (current === seconds) return { calls: [], note: `already ${seconds}` };
      return {
        calls: [
          {
            to: chain.router!,
            data: ROUTER_IFACE.encodeFunctionData("setMaxWarrantDuration", [seconds]),
            value: "0",
            label: `setMaxWarrantDuration(${seconds})  [was ${current}]`,
          },
        ],
      };
    }

    case "sweep": {
      const cfg = NETWORK_CONFIGS[chain.network];
      if (!cfg) return { calls: [], note: "NO_NETWORK_CONFIG" };

      const to = getAddress(String(params.to));
      const includeEth = params.includeEth !== false;
      const minUsd = Number(params.minUsd ?? 0);

      // sweepAll takes ONLY a token address list (plus includeEth and the
      // recipient). It reads balanceOf(this) per entry at execution, moves the
      // full balance, and skips zero balances without calling transfer. So
      // what goes in the calldata is a choice about COST, not knowledge:
      //   full    : the whole curated list -- identical calldata every cycle,
      //             zero entries cost ~8k gas each and move nothing
      //   nonzero : only entries holding a balance at build time
      // Balances and USD figures below never enter the calldata; they exist to
      // pick the mode and to itemize the (unsigned) manifest for signers.
      const explicit = params.tokens as string[] | undefined;
      const fromScan = scanAssetsByNetwork.get(chain.network);
      let assets: PricedFeeAsset[];
      let nativeBalance = 0n;
      let nativeValue: PricedFeeAsset | undefined;
      let listTokens: string[] = [];
      const symbolOf = new Map<string, string>();

      if (explicit && explicit.length > 0) {
        const unsweepable = universeInternal.UNSWEEPABLE[chain.chainId] ?? {};
        const usable = explicit.filter(
          (a) => !universeInternal.NOT_A_TOKEN.has(a) && !unsweepable[a],
        );
        const found = await readNonZeroBalances(provider, chain.router!, usable);
        const { priced } = await priceAssets(provider, cfg, found);
        assets = priced;
        nativeBalance = await provider.getBalance(chain.router!);
      } else {
        if (!sweepFeeTokens?.chains[String(chain.chainId)]) {
          throw new Error(
            `${chain.network} is not in data/fee-tokens.json. Run ` +
              `\`npx hardhat fees:tokens --bootstrap --networks ${chain.network}\` and commit it.`,
          );
        }
        const { tokens, dropped } = sweepTokensFor(sweepFeeTokens, chain.chainId);
        for (const d of dropped) console.log(`  ${pad(chain.network, 12)} ! ignoring ${d.address}: ${d.reason}`);
        listTokens = tokens.map((t) => t.address);
        for (const t of tokens) symbolOf.set(t.address, t.symbol);

        if (fromScan) {
          const toPriced = (a: SnapshotAsset): PricedFeeAsset => ({
            token: a.token,
            symbol: a.symbol,
            decimals: a.decimals,
            balance: BigInt(a.amountRaw),
            usdPrice: a.usdPrice,
            usdValue: a.usdValue,
            usdValueThin: a.usdValueThin,
            priceTier: a.priceTier,
            priceSource: a.priceSource,
          });
          assets = fromScan.filter((a) => a.token !== NATIVE_SENTINEL).map(toPriced);
          const nat = fromScan.find((a) => a.token === NATIVE_SENTINEL);
          if (nat) {
            nativeValue = toPriced(nat);
            nativeBalance = nativeValue.balance;
          }
        } else {
          const scan = await scanChainFees(provider, cfg, chain.router!, {
            price: true,
            candidates: listTokens,
          });
          if (scan.unchecked > 0) {
            throw new Error(`${scan.unchecked} curated token balance(s) could not be read; retry or use a better RPC`);
          }
          assets = scan.assets.filter((a) => a.token !== NATIVE_SENTINEL);
          const nat = scan.assets.find((a) => a.token === NATIVE_SENTINEL);
          if (nat) {
            nativeValue = nat;
            nativeBalance = nat.balance;
          }
        }
      }
      for (const a of assets) symbolOf.set(a.token, a.symbol);

      const sweepEth = includeEth && nativeBalance > 0n;
      if (assets.length === 0 && !sweepEth) {
        // A chain with nothing to sweep is dropped rather than burning a
        // nonce on a no-op.
        return { calls: [], note: "no idle fees on this chain" };
      }

      // Optional economic floor, against NOTIONAL. Unpriced assets count $0
      // and the note says how many.
      if (minUsd > 0) {
        const { notional, unpriced } = totalUsd(assets);
        if (notional < minUsd) {
          return {
            calls: [],
            note:
              `below --min-usd: notional $${notional.toFixed(2)} < $${minUsd.toFixed(2)}` +
              `${unpriced ? ` (${unpriced} asset(s) unpriced, counted as $0)` : ""}`,
          };
        }
      }

      // ---- mode --------------------------------------------------------
      const nonzeroTokens = sortTokens(assets.map((a) => ({ address: a.token }))).map((t) => t.address);
      const fullTokens = sortTokens(
        [...new Set([...listTokens, ...nonzeroTokens])].map((address) => ({ address })),
      ).map((t) => t.address);
      const configured: SweepMode = explicit?.length
        ? "nonzero"
        : sweepFeeTokens!.chains[String(chain.chainId)].mode;
      const cap = await sweepGasCap(provider);

      let gasFull: bigint | null = null;
      let gasNonzero: bigint | null = null;
      let gasPriceWei: bigint | null = null;
      let nativeUsd: number | null = nativeValue?.usdPrice ?? null;
      if (configured !== "nonzero") {
        gasFull = await estimateSweepGas(provider, safeAddress, chain.router!, fullTokens, includeEth, to);
      }
      if (configured === "auto" && fullTokens.length > nonzeroTokens.length) {
        gasNonzero = await estimateSweepGas(provider, safeAddress, chain.router!, nonzeroTokens, sweepEth, to);
        try {
          const fd = await provider.getFeeData();
          gasPriceWei = fd.gasPrice ?? fd.maxFeePerGas ?? null;
        } catch {
          gasPriceWei = null;
        }
        if (nativeUsd === null) {
          const { nativeUsd: px } = await priceAssets(provider, cfg, [
            { token: NATIVE_SENTINEL, symbol: cfg.nativeSymbol, decimals: 18, balance: 10n ** 18n },
          ]);
          nativeUsd = px;
        }
      }
      let decision: ModeDecision = explicit?.length
        ? { mode: "nonzero", reason: "explicit --tokens", extraUsd: null }
        : chooseSweepMode({
            configured,
            maxUsd: sweepFeeTokens!.fullSweepMaxUsd,
            extraGas:
              gasFull !== null && gasNonzero !== null
                ? (gasFull > gasNonzero ? gasFull - gasNonzero : 0n)
                : fullTokens.length === nonzeroTokens.length
                  ? 0n
                  : null,
            gasPriceWei,
            nativeUsd,
            zeroEntries: fullTokens.length - nonzeroTokens.length,
          });
      if (decision.mode === "full" && gasFull !== null && gasFull > cap) {
        decision = {
          mode: "nonzero",
          reason: `full list estimates ${gasFull} gas > cap ${cap}`,
          extraUsd: decision.extraUsd,
        };
      }

      const callTokens = decision.mode === "full" ? fullTokens : nonzeroTokens;
      // Full mode always carries includeEth so the calldata does not change
      // with the native balance; sweepAll skips a zero native balance.
      const withEth = decision.mode === "full" ? includeEth : sweepEth;
      const gasChosen =
        decision.mode === "full" && gasFull !== null
          ? gasFull
          : await estimateSweepGas(provider, safeAddress, chain.router!, callTokens, withEth, to);
      if (gasChosen !== null && gasChosen > cap) {
        throw new Error(`sweepAll of ${callTokens.length} token(s) estimates ${gasChosen} gas > cap ${cap}`);
      }

      // One direct CALL to the router: no MultiSend, no DELEGATECALL, so the
      // wallet shows to=router, operation=0 on every chain.
      const data = encodeSweepAll(callTokens, withEth, to);
      const calls: BundleCall[] = [
        {
          to: chain.router!,
          data,
          value: "0",
          label: sweepLabel(data, decision.mode),
        },
      ];

      const snapshot: SweepAssetSnapshot[] = assets.map((a) => ({
        token: a.token,
        symbol: a.symbol,
        decimals: a.decimals,
        amountRaw: a.balance.toString(),
        amount: fmtAmount(a),
        usdValue: a.usdValue,
        usdValueThin: a.usdValueThin,
        priceSource: a.priceSource,
      }));
      if (sweepEth) {
        snapshot.push({
          token: NATIVE_SENTINEL,
          symbol: cfg.nativeSymbol,
          decimals: 18,
          amountRaw: nativeBalance.toString(),
          amount: formatUnits(nativeBalance, 18),
          usdValue: nativeValue?.usdValue,
          usdValueThin: nativeValue?.usdValueThin,
          priceSource: nativeValue?.priceSource,
        });
      }
      const totals = totalUsd(sweepEth && nativeValue ? [...assets, nativeValue] : assets);

      sweepManifests.set(`${chain.network}`, {
        recipient: to,
        includeEth: withEth,
        assets: snapshot,
        usdNotional: totals.notional,
        unpricedCount: totals.unpriced,
        thinUsd: totals.thinUsd,
        thinCount: totals.thinCount,
        mode: decision.mode,
        modeReason: decision.reason,
        extraUsd: decision.extraUsd,
        gasEstimate: gasChosen?.toString(),
        tokens: callTokens.map((t) => ({ token: t, symbol: symbolOf.get(t) ?? "?" })),
      });

      return { calls };
    }
  }
}

/**
 * Call label for a sweep, derived from the calldata itself so it can only
 * describe what is signed. Amounts are deliberately absent: they are not in
 * the transaction.
 */
function sweepLabel(data: string, mode: string): string {
  const d = decodeSweepAll(data);
  return (
    `sweepAll(tokens=[${d.tokens.length}], includeEth=${d.includeEth}, to=${getAddress(d.to)})` +
    `  [${mode}]`
  );
}

/**
 * Per-chain sweep manifests produced during callsForIntent, keyed by network.
 *
 * callsForIntent's return type is shared by every intent, so this side channel
 * carries the richer sweep data out to the bundle assembler without
 * distorting the other five intents.
 */
const sweepManifests = new Map<string, NonNullable<BundleChain["sweep"]>>();

/**
 * Per-chain asset lists taken from a `--from-scan` snapshot, keyed by network.
 *
 * Populated before the build loop so the sweep intent can skip discovery
 * entirely. Only the token ADDRESSES are load-bearing -- they are what
 * sweepAll receives. The amounts ride along solely to itemize the signing
 * page, where they are labelled as an estimate.
 */
const scanAssetsByNetwork = new Map<string, SnapshotAsset[]>();

/**
 * The curated sweep list (data/fee-tokens.json), loaded once per build.
 * Undefined only for an explicit `--tokens` build.
 */
let sweepFeeTokens: FeeTokensFile | undefined;

/**
 * Chains that FAILED to build, as opposed to chains with nothing to do.
 *
 * The build loop turns both into `null`, which means a transient RPC error is
 * indistinguishable from "already in the desired state" -- on a 34-chain
 * sweep that is a silent loss of collectable fees. Recorded here so the
 * summary can name them and the process can exit non-zero.
 */
const buildErrors: { network: string; message: string }[] = [];

/** Relayer funding warnings collected during a sweep build. */
const relayerShortfalls: string[] = [];
/** execTransaction overhead on top of sweepAll (2 ECDSA sigs, events). */
const RELAYER_EXEC_OVERHEAD = 90_000n;
/** Headroom over the estimate; absorbs L1 data fees on rollups. */
const RELAYER_HEADROOM = 3n;

/**
 * Resolve wallet-facing chain metadata from chain-config for the signing
 * page. Returns undefined rather than throwing if a chain is unknown -- the
 * page degrades to requiring the signer to add the network manually.
 */
function resolveChainMeta(chainId: number): BundleChainMeta | undefined {
  const n = MAINNET_CHAINS.find((x) => Number(x.id) === chainId);
  if (!n) return undefined;
  return {
    chainName: n.name,
    rpcUrl: n.rpcUrls.default.http[0],
    nativeCurrency: {
      name: n.nativeCurrency.name,
      symbol: n.nativeCurrency.symbol,
      decimals: n.nativeCurrency.decimals,
    },
    blockExplorerUrl: n.blockExplorers?.default?.url,
  };
}

// ---------------------------------------------------------------------------
// Signature storage
//
// Signatures are kept in per-signer sidecar files, never inside the bundle:
//
//   safe-bundles/<name>.json                     transaction definition (committed)
//   safe-bundles/<name>/signatures-<signer>.json signature material (gitignored)
//
// This split is what makes the bundle safe to commit. A bundle that has
// accumulated `threshold` signatures is a bearer authorization -- anyone
// holding it can execute it -- so it must never enter git history. The
// definition on its own authorizes nothing, is derivable from public chain
// state, and is genuinely useful to have under version control: it is the
// record of exactly what was approved, and co-signers can pull it instead of
// being emailed a file.
//
// `safe:exec` reads sidecars and merges them with any legacy in-bundle
// signatures, so older bundles still work.
// ---------------------------------------------------------------------------

export interface SignatureEntry {
  safeTxHash: string;
  signer: string;
  signature: string;
}

function sidecarDir(name: string): string {
  return path.join(BUNDLE_DIR, name);
}

function sidecarFile(name: string, signer: string): string {
  return path.join(sidecarDir(name), `signatures-${getAddress(signer)}.json`);
}

/** Read every per-signer sidecar for a bundle. */
function readSidecars(name: string): SignatureEntry[] {
  const dir = sidecarDir(name);
  if (!fs.existsSync(dir)) return [];
  const out: SignatureEntry[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^signatures-0x[0-9a-fA-F]{40}\.json$/.test(f)) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (Array.isArray(arr)) out.push(...arr);
    } catch {
      console.log(`  ⚠ ignoring unreadable sidecar ${f}`);
    }
  }
  return out;
}

/** Merge new entries into the signer's sidecar, deduped. Returns count added. */
function writeSidecar(name: string, entries: readonly SignatureEntry[]): number {
  const bySigner = new Map<string, SignatureEntry[]>();
  for (const e of entries) {
    const s = getAddress(e.signer);
    if (!bySigner.has(s)) bySigner.set(s, []);
    bySigner.get(s)!.push({ ...e, signer: s });
  }
  let added = 0;
  fs.mkdirSync(sidecarDir(name), { recursive: true });
  for (const [signer, list] of bySigner) {
    const file = sidecarFile(name, signer);
    let existing: SignatureEntry[] = [];
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (Array.isArray(parsed)) existing = parsed;
      } catch {
        existing = [];
      }
    }
    for (const e of list) {
      const dup = existing.some(
        (x) =>
          x.safeTxHash.toLowerCase() === e.safeTxHash.toLowerCase() &&
          getAddress(x.signer) === signer,
      );
      if (!dup) {
        existing.push(e);
        added++;
      }
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(existing, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
  }
  return added;
}

/**
 * All valid signatures for one chain: sidecars plus any legacy in-bundle
 * entries, deduped by signer and filtered to current owners.
 */
function signaturesFor(
  bundle: Bundle,
  chain: BundleChain,
  sidecars: readonly SignatureEntry[],
): { signer: string; signature: string }[] {
  const owners = new Set(bundle.owners.map((o) => getAddress(o)));
  const out: { signer: string; signature: string }[] = [];
  const seen = new Set<string>();
  const consider = [
    ...chain.signatures.map((s) => ({ ...s, safeTxHash: chain.safeTxHash })),
    ...sidecars,
  ];
  for (const e of consider) {
    if (e.safeTxHash.toLowerCase() !== chain.safeTxHash.toLowerCase()) continue;
    let signer: string;
    try {
      signer = getAddress(e.signer);
    } catch {
      continue;
    }
    if (!owners.has(signer) || seen.has(signer)) continue;
    seen.add(signer);
    out.push({ signer, signature: e.signature });
  }
  return out;
}

function bundlePath(name: string): string {
  return path.join(BUNDLE_DIR, `${name}.json`);
}

function readBundle(name: string): Bundle {
  const p = bundlePath(name);
  if (!fs.existsSync(p)) throw new Error(`bundle not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as Bundle;
}

function writeBundle(b: Bundle): string {
  if (!fs.existsSync(BUNDLE_DIR)) fs.mkdirSync(BUNDLE_DIR, { recursive: true });
  const p = bundlePath(b.name);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(b, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
  return p;
}

/** Safe Transaction Builder JSON, importable at app.safe.global. */
function txBuilderJson(chain: BundleChain, safe: string) {
  return {
    version: "1.0",
    chainId: String(chain.chainId),
    createdAt: Date.now(),
    meta: {
      name: `oku-${chain.network}`,
      description: chain.calls.map((c) => c.label).join(" | "),
      createdFromSafeAddress: safe,
    },
    transactions: chain.calls.map((c) => ({
      to: c.to,
      value: c.value,
      data: c.data,
    })),
  };
}

// ---------------------------------------------------------------------------
// safe:build
// ---------------------------------------------------------------------------

task("safe:build", "Diff on-chain state and emit a per-chain SafeTx bundle")
  .addParam(
    "intent",
    "accept-ownership | transfer-ownership | pause | unpause | swap-targets | valid-signer | max-warrant-duration | sweep",
  )
  .addOptionalParam("name", "Bundle name (default: <intent>-<timestamp>)")
  .addOptionalParam("networks", "Comma-separated list of networks to restrict to")
  .addOptionalParam("address", "For valid-signer: the signer address")
  .addOptionalParam("add", "For valid-signer: true|false")
  .addOptionalParam("seconds", "For max-warrant-duration: the new duration")
  .addOptionalParam(
    "to",
    "For sweep: recipient (default: OKU_FEE_RECIPIENT). For transfer-ownership: the new owner Safe",
  )
  .addOptionalParam("tokens", "For sweep: comma-separated token list (default: data/fee-tokens.json)")
  .addOptionalParam("maxTokens", "Obsolete; ignored (one sweepAll per chain, capped by gas)")
  .addOptionalParam(
    "fromScan",
    "For sweep: path to a fees:cycle / fees:scan snapshot. Uses its asset lists instead " +
      "of re-discovering, so the bundle matches the report that was reviewed.",
  )
  .addOptionalParam(
    "minUsd",
    "For sweep: skip chains whose realizable total is below this (default 0 = no filter)",
  )
  .addOptionalParam(
    "rpc",
    "Override RPC URL (single --networks only). For multi-chain runs set <NET>_URL per chain.",
  )
  .addFlag("noEth", "For sweep: do NOT sweep the native balance")
  .addFlag("force", "For transfer-ownership: allow a --to other than the pinned v2 Safe")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    assertOkuSafeConfig();
    const dep = getOkuSafeDeployment();
    const intent = String(taskArgs.intent) as Intent;
    const valid: Intent[] = [
      "accept-ownership",
      "transfer-ownership",
      "pause",
      "unpause",
      "swap-targets",
      "valid-signer",
      "max-warrant-duration",
      "sweep",
    ];
    if (!valid.includes(intent)) {
      throw new Error(`unknown --intent ${intent}. Expected one of: ${valid.join(", ")}`);
    }
    const params: Record<string, unknown> = {};
    if (intent === "valid-signer") {
      if (!taskArgs.address) throw new Error("--address is required for valid-signer");
      if (taskArgs.add === undefined) throw new Error("--add true|false is required");
      params.address = getAddress(String(taskArgs.address));
      params.add = String(taskArgs.add) === "true";
    }
    if (intent === "max-warrant-duration") {
      if (!taskArgs.seconds) throw new Error("--seconds is required");
      params.seconds = String(taskArgs.seconds);
    }
    if (intent === "transfer-ownership") {
      if (!taskArgs.to) {
        throw new Error(
          "--to is required for transfer-ownership (the new owner Safe address)",
        );
      }
      const to = getAddress(String(taskArgs.to));
      if (to === getAddress(ZeroAddress)) {
        throw new Error("transfer-ownership target cannot be the zero address");
      }
      if (to === getAddress(dep.address)) {
        throw new Error(
          "transfer-ownership target is the signing Safe itself -- that is a no-op",
        );
      }
      // Typing a wrong address here hands 34 routers to a Safe nobody
      // controls. The only destination this migration has any business
      // using is the pinned v2 Safe, so anything else must be stated twice.
      if (!taskArgs.force) {
        throw new Error(
          `transfer-ownership moves all router authority to ${to}. There is no ` +
            `pinned successor Safe configured, so this cannot be checked for you. ` +
            `Verify the destination is a Safe you control, then re-run with --force.`,
        );
      }
      params.to = to;
    }
    if (intent === "sweep") {
      // Defaults to the committed constant so the destination of an
      // irreversible transfer is reviewed in a diff, not retyped per ceremony.
      const to = getAddress(String(taskArgs.to ?? OKU_FEE_RECIPIENT));
      if (to === "0x0000000000000000000000000000000000000000") {
        throw new Error("sweep recipient cannot be the zero address");
      }
      params.to = to;
      params.includeEth = !taskArgs.noEth;
      if (taskArgs.tokens) {
        params.tokens = String(taskArgs.tokens)
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((s: string) => getAddress(s));
      }
      if (taskArgs.maxTokens) {
        console.log("  ! --max-tokens is obsolete: sweeps are one sweepAll call per chain, capped by gas");
      }
      if (taskArgs.minUsd) params.minUsd = Number(taskArgs.minUsd);
      sweepManifests.clear();
      scanAssetsByNetwork.clear();
      sweepFeeTokens = undefined;
      if (!params.tokens) {
        sweepFeeTokens = loadFeeTokens();
        params.feeTokensUpdatedAt = sweepFeeTokens.updatedAt;
        params.fullSweepMaxUsd = sweepFeeTokens.fullSweepMaxUsd;
        console.log(
          `\nToken list      : data/fee-tokens.json (updated ${sweepFeeTokens.updatedAt}, ` +
            `full-list limit $${sweepFeeTokens.fullSweepMaxUsd})`,
        );
      }
      if (taskArgs.fromScan) {
        const snapPath = path.resolve(String(taskArgs.fromScan));
        const snap = readSnapshot(snapPath);
        for (const c of snap.chains) {
          if (c.status !== "has-fees") continue;
          scanAssetsByNetwork.set(c.network, c.assets);
        }
        // Recorded so the bundle says which observation it was built from.
        // The snapshot itself is gitignored and will not survive; the
        // reference still pins the date and generation time.
        params.scanRef = path.relative(path.resolve(__dirname, ".."), snapPath);
        params.scanGeneratedAt = snap.generatedAt;
        console.log(`\nUsing scan       : ${params.scanRef}  (${snap.generatedAt})`);
        console.log(
          `  chains with fees: ${scanAssetsByNetwork.size}` +
            `${snap.totals.chainsErrored ? `, ${snap.totals.chainsErrored} errored during scan` : ""}`,
        );
      }
      console.log(`\nSweep recipient: ${to}${taskArgs.to ? " (explicit --to)" : " (OKU_FEE_RECIPIENT)"}`);
      console.log(`Include native  : ${params.includeEth}`);
      if (params.minUsd) console.log(`Minimum USD     : $${Number(params.minUsd).toFixed(2)}`);
    }
    buildErrors.length = 0;
    relayerShortfalls.length = 0;

    const only = taskArgs.networks
      ? new Set<string>(
          String(taskArgs.networks)
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean),
        )
      : undefined;
    const chains = listSafeChains(hre, only).filter((c) => c.router);

    if (taskArgs.rpc && chains.length !== 1) {
      throw new Error(
        `--rpc applies to one chain, but ${chains.length} were selected. ` +
          `Pass --networks <single network> alongside --rpc, or set <NET>_URL ` +
          `per chain for a multi-chain run.`,
      );
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name = String(taskArgs.name ?? `${intent}-${stamp}`);

    console.log("\n" + "=".repeat(96));
    console.log(`SAFE BUILD  intent=${intent}`);
    console.log("=".repeat(96));
    console.log(`Safe   : ${dep.address}  (${dep.threshold} of ${dep.owners.length})`);
    console.log(`Bundle : ${name}`);
    console.log(`Chains : ${chains.length}`);

    const built = await mapLimit(chains, 5, async (chain): Promise<BundleChain | null> => {
      const rpc = taskArgs.rpc ? String(taskArgs.rpc) : chain.rpcUrl;
      if (!rpc) {
        console.log(`  ${pad(chain.network, 12)} skip: NO_RPC`);
        return null;
      }
      const provider = makeProvider(rpc, chain.chainId);
      try {
        // The Safe must exist before we can read its nonce or hash a tx.
        const code = await withRetry(
          () => provider.getCode(dep.address),
          `${chain.network}:getCode(safe)`,
        );
        if (code === "0x") {
          console.log(`  ${pad(chain.network, 12)} skip: Safe not deployed on this chain`);
          return null;
        }

        const { calls, note } = await callsForIntent(
          intent,
          params,
          chain,
          provider,
          dep.address,
        );
        if (calls.length === 0) {
          console.log(`  ${pad(chain.network, 12)} nothing to do${note ? ` (${note})` : ""}`);
          return null;
        }

        const nonceRaw = await withRetry(
          () =>
            provider.call({
              to: dep.address,
              data: SAFE_IFACE.encodeFunctionData("nonce"),
            }),
          `${chain.network}:safe.nonce()`,
        );
        const nonce = SAFE_IFACE.decodeFunctionResult("nonce", nonceRaw)[0] as bigint;

        const tx = buildBatchedSafeTx(
          calls.map((c) => ({ to: c.to, data: c.data, value: BigInt(c.value) })),
          nonce,
        );

        // Cross-check our EIP-712 against the Safe's own view function. If
        // these disagree every signature we collect would be worthless, so
        // we refuse to emit the bundle rather than waste a signing ceremony.
        const check = await verifySafeTxHashOnChain(provider, chain.chainId, dep.address, tx);
        if (!check.match) {
          throw new Error(
            `safeTxHash mismatch: local ${check.local} vs on-chain ${check.onChain}`,
          );
        }

        // Simulate the whole execTransaction with a fabricated-but-structurally
        // valid signature set is not possible (signatures are checked), so we
        // instead simulate the inner calls from the Safe to catch reverts like
        // "not the owner" or a bad target before signing.
        for (const c of calls) {
          try {
            await provider.call({ from: dep.address, to: c.to, data: c.data });
          } catch (e) {
            const anyE = e as { data?: string; shortMessage?: string; message?: string };
            const reason = anyE.data ? decodeRevert(anyE.data) : undefined;
            throw new Error(
              `inner call would revert (${c.label}): ${reason ?? anyE.shortMessage ?? anyE.message}`,
            );
          }
        }

        const batched = tx.to === getAddress(SAFE_MULTISEND_CALL_ONLY);
        const m = sweepManifests.get(chain.network);

        // Relayer funding, checked now rather than discovered at broadcast:
        // a signed bundle that cannot be relayed on one chain just sits there
        // (rootstock, 2026-10-16). Warn only -- funding can happen after signing.
        if (m?.gasEstimate) {
          try {
            const fee = await provider.getFeeData();
            const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
            const need = (BigInt(m.gasEstimate) + RELAYER_EXEC_OVERHEAD) * price * RELAYER_HEADROOM;
            const bal = await provider.getBalance(OKU_DEPLOYER_EOA);
            if (bal < need) {
              relayerShortfalls.push(
                `${chain.network}: relayer ${OKU_DEPLOYER_EOA} holds ${formatUnits(bal, 18)}, ` +
                  `needs ${formatUnits(need, 18)} ${NETWORK_CONFIGS[chain.network]?.nativeSymbol ?? ""} ` +
                  `(${RELAYER_HEADROOM}x est.); top up ${formatUnits(need - bal, 18)} before broadcast`,
              );
            }
          } catch (e) {
            relayerShortfalls.push(`${chain.network}: relayer balance check failed (${String((e as Error).message).slice(0, 60)})`);
          }
        }
        console.log(
          `  ${pad(chain.network, 12)} ${calls.length} call(s)` +
            `${batched ? " [MultiSend]" : ""}  nonce=${nonce}  hash=${check.local.slice(0, 18)}…` +
            `${m?.mode ? `  ${m.mode} ${m.tokens?.length ?? 0} tok, gas ${m.gasEstimate ?? "?"} (${m.modeReason})` : ""}`,
        );

        return {
          network: chain.network,
          chainId: chain.chainId,
          router: chain.router!,
          nonce: nonce.toString(),
          chainMeta: resolveChainMeta(chain.chainId),
          calls,
          tx: serializeTx(tx),
          safeTxHash: check.local,
          eip712: TypedDataEncoder.getPayload(
            safeDomain(chain.chainId, dep.address),
            SAFE_TX_TYPES,
            tx,
          ),
          signatures: [],
          note,
        };
      } catch (e) {
        const anyE = e as { shortMessage?: string; message?: string };
        const message = String(anyE.shortMessage ?? anyE.message ?? e);
        // Recorded, not just logged: a failure here excludes the chain from
        // the bundle exactly as "nothing to do" does, and the two must not
        // look alike in the summary.
        buildErrors.push({ network: chain.network, message });
        console.log(`  ${pad(chain.network, 12)} ✗ ${message}`);
        return null;
      } finally {
        provider.destroy();
      }
    });

    const chainsOut = built.filter((b): b is BundleChain => b !== null);
    if (chainsOut.length === 0) {
      console.log("\nNothing to do on any chain. No bundle written.");
      reportBuildErrors();
      return;
    }
    chainsOut.sort((a, b) => a.chainId - b.chainId);

    // Attach the per-chain sweep manifest so the signing page can render an
    // itemized fund-movement panel, and so the bundle is self-describing when
    // audited later. Carries no authorization material.
    if (intent === "sweep") {
      for (const c of chainsOut) {
        const m = sweepManifests.get(c.network);
        if (m) c.sweep = m;
      }
      params.recipient = params.to;
      params.totalUsdNotional = chainsOut.reduce((s, c) => s + (c.sweep?.usdNotional ?? 0), 0);
      params.totalUnpriced = chainsOut.reduce((s, c) => s + (c.sweep?.unpricedCount ?? 0), 0);
      params.totalThinUsd = chainsOut.reduce((s, c) => s + (c.sweep?.thinUsd ?? 0), 0);
      params.totalThin = chainsOut.reduce((s, c) => s + (c.sweep?.thinCount ?? 0), 0);
    }

    const bundle: Bundle = {
      name,
      intent,
      params,
      safe: dep.address,
      threshold: dep.threshold,
      owners: [...dep.owners],
      createdAt: new Date().toISOString(),
      chains: chainsOut,
    };
    const p = writeBundle(bundle);

    // Companion artifacts: Transaction Builder JSON for the Safe UI chains,
    // and raw EIP-712 payloads for offline / hardware signers everywhere.
    const auxDir = path.join(BUNDLE_DIR, name);
    fs.mkdirSync(path.join(auxDir, "tx-builder"), { recursive: true });
    fs.mkdirSync(path.join(auxDir, "eip712"), { recursive: true });
    for (const c of chainsOut) {
      if (hasSafeTxService(c.chainId)) {
        fs.writeFileSync(
          path.join(auxDir, "tx-builder", `${c.network}.json`),
          JSON.stringify(txBuilderJson(c, dep.address), null, 2) + "\n",
        );
      }
      fs.writeFileSync(
        path.join(auxDir, "eip712", `${c.network}.json`),
        JSON.stringify(c.eip712, null, 2) + "\n",
      );
    }

    console.log("\n" + "-".repeat(96));
    console.log(`Bundle written : ${p}`);
    console.log(`  chains needing action : ${chainsOut.length}`);
    console.log(`  total calls           : ${chainsOut.reduce((a, c) => a + c.calls.length, 0)}`);
    console.log(`  signatures needed     : ${chainsOut.length} x ${dep.threshold}`);
    console.log(`  tx-builder JSON       : ${path.join(auxDir, "tx-builder")}  (import at app.safe.global)`);
    console.log(`  EIP-712 payloads      : ${path.join(auxDir, "eip712")}  (safe-cli / offline signers)`);
    console.log(
      `\nEvery safeTxHash above was verified against the Safe's own ` +
        `getTransactionHash(),\nand every inner call was simulated from the Safe ` +
        `address to prove it will not revert.`,
    );
    if (relayerShortfalls.length) {
      console.log(`\nRELAYER FUNDING (fix before safe:exec --broadcast; signing can proceed):`);
      for (const w of relayerShortfalls) console.log(`  ! ${w}`);
    }
    reportBuildErrors();
    console.log("");
  });

/**
 * Name the chains that failed to build and set a non-zero exit code.
 *
 * Without this a sweep that silently dropped six chains to RPC timeouts looks
 * identical to one where those six had nothing to collect.
 */
function reportBuildErrors(): void {
  if (buildErrors.length === 0) return;
  console.log("\n" + "!".repeat(96));
  console.log(
    `${buildErrors.length} chain(s) FAILED to build and are NOT in the bundle. ` +
      `They were not\nproven to be in the desired state -- they could not be read:`,
  );
  for (const e of buildErrors) console.log(`  ${pad(e.network, 12)} ${e.message}`);
  console.log("!".repeat(96));
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// safe:merge
// ---------------------------------------------------------------------------

task(
  "safe:merge",
  "Combine bundles that touch disjoint chains into one, so signers sign once",
)
  .addParam("name", "Name for the merged bundle")
  .addParam("from", "Comma-separated bundle names to merge")
  .setAction(async (taskArgs) => {
    assertOkuSafeConfig();
    const sources = String(taskArgs.from)
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (sources.length < 2) {
      throw new Error("--from needs at least two bundle names");
    }
    const outName = String(taskArgs.name);
    if (sources.includes(outName)) {
      throw new Error(`--name ${outName} collides with one of the source bundles`);
    }

    const loaded = sources.map((n) => readBundle(n));

    // Every bundle must target the same Safe with the same owner set and
    // threshold, or the merged bundle would be incoherent to sign.
    const first = loaded[0];
    for (const b of loaded.slice(1)) {
      if (getAddress(b.safe) !== getAddress(first.safe)) {
        throw new Error(`bundle ${b.name} targets a different Safe (${b.safe})`);
      }
      if (b.threshold !== first.threshold) {
        throw new Error(`bundle ${b.name} has threshold ${b.threshold}, expected ${first.threshold}`);
      }
      const a = first.owners.map((o) => getAddress(o)).sort().join(",");
      const c = b.owners.map((o) => getAddress(o)).sort().join(",");
      if (a !== c) throw new Error(`bundle ${b.name} has a different owner set`);
    }

    // Chains must be disjoint. Two entries for one chain would be two
    // transactions competing for the same Safe nonce: only the first could
    // ever execute, and the second's signatures would be silently dead. Fail
    // loudly rather than produce a bundle that is half-unexecutable.
    const byChain = new Map<number, string>();
    for (const b of loaded) {
      for (const c of b.chains) {
        const prev = byChain.get(c.chainId);
        if (prev) {
          throw new Error(
            `chain ${c.network} (${c.chainId}) appears in both "${prev}" and "${b.name}". ` +
              `Both would target Safe nonce ${c.nonce}, so only one could execute. ` +
              `Rebuild them as a single bundle with safe:build instead.`,
          );
        }
        byChain.set(c.chainId, b.name);
      }
    }

    // Pure concatenation: every chain keeps its own safeTxHash untouched, so
    // any signatures already collected against a source bundle stay valid.
    const merged: Bundle = {
      name: outName,
      intent: first.intent,
      params: Object.fromEntries(loaded.map((b) => [b.name, b.params])),
      safe: first.safe,
      threshold: first.threshold,
      owners: [...first.owners],
      createdAt: new Date().toISOString(),
      chains: loaded.flatMap((b) => b.chains).sort((a, b) => a.chainId - b.chainId),
    };
    const p = writeBundle(merged);

    console.log("");
    console.log(`Merged bundle written: ${p}`);
    for (const b of loaded) {
      console.log(
        `  from ${b.name.padEnd(24)} intent=${String(b.intent).padEnd(20)} ` +
          `${b.chains.length} chain(s): ${b.chains.map((c) => c.network).join(", ")}`,
      );
    }
    console.log("");
    console.log(`  total chains        : ${merged.chains.length}`);
    console.log(`  signatures needed   : ${merged.chains.length} x ${merged.threshold}`);
    for (const c of merged.chains) {
      console.log(
        `    ${c.network.padEnd(12)} nonce=${String(c.nonce).padEnd(4)} ` +
          `${c.calls.length} call(s)  ${c.safeTxHash}`,
      );
    }
    console.log("");
    console.log(`Each safeTxHash is carried over unchanged, so signatures already`);
    console.log(`collected against a source bundle remain valid here. Next:`);
    console.log(`  npx hardhat safe:sign-page --name ${outName}`);
    console.log("");
  });

// ---------------------------------------------------------------------------
// safe:sign-page
// ---------------------------------------------------------------------------

task(
  "safe:sign-page",
  "Emit a self-contained signing page with the bundle embedded (no file picker, no fetch)",
)
  .addParam("name", "Bundle name")
  .setAction(async (taskArgs) => {
    assertOkuSafeConfig();
    const bundle = readBundle(String(taskArgs.name));
    const tpl = path.resolve(__dirname, "..", "scripts", "safeSignPage", "index.html");
    if (!fs.existsSync(tpl)) {
      throw new Error(`signing page template not found at ${tpl}`);
    }
    const templateHtml = fs.readFileSync(tpl, "utf8");

    // Delegate to the shared builder so this task and `npm run sign-page`
    // cannot drift. The "strip signature bytes before the file is
    // distributed" guarantee therefore lives in exactly one place: the page
    // receives `signedBy` (addresses only) so it can grey out rows the
    // connected account already signed, and no signature material at all.
    const { buildSignPage } = require("../scripts/safeSignPage/buildPage");
    const sidecars = readSidecars(bundle.name);
    const html: string = buildSignPage(templateHtml, bundle, sidecars);
    const embeddedSigs = 0;

    const outDir = path.join(BUNDLE_DIR, bundle.name);
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, "sign.html");
    fs.writeFileSync(out, html, "utf8");

    const chains = bundle.chains.length;
    const need = bundle.chains.filter(
      (c) => signaturesFor(bundle, c, sidecars).length < bundle.threshold,
    ).length;
    const alreadySigned = new Set(
      bundle.chains.flatMap((c) =>
        signaturesFor(bundle, c, sidecars).map((s) => s.signer),
      ),
    );
    console.log("");
    console.log(`Self-contained signing page written:`);
    console.log(`  ${out}`);
    console.log(`  bundle embedded  : ${bundle.name} (${chains} chain(s), ${need} still short)`);
    console.log(`  safe             : ${bundle.safe}  ${bundle.threshold} of ${bundle.owners.length}`);
    console.log(`  signatures inside: ${embeddedSigs}  (stripped -- safe to distribute)`);
    if (alreadySigned.size) {
      console.log(
        `  already signed by: ${[...alreadySigned].join(", ")}` +
          `  (recorded as signedBy, no signature bytes)`,
      );
    }
    console.log("");
    console.log(`Next:`);
    console.log(`  npm run sign-page`);
    console.log(`  then open  http://127.0.0.1:8547/${bundle.name}/sign.html`);
    console.log("");
    console.log(
      `Use that URL, not a file:// path -- MetaMask does not inject a provider into\n` +
        `file:// pages unless "Allow access to file URLs" is enabled. The server binds\n` +
        `loopback only and serves safe-bundles/ (never the repo root, which holds .env).`,
    );
    console.log("");
    console.log(
      `This file contains the full transaction set but NO signature bytes and NO\n` +
        `keys, so it is safe to send to a co-signer. Their output comes back via:\n` +
        `  npx hardhat safe:sign --name ${bundle.name} --import <signatures.json>`,
    );
    console.log("");
  });

// ---------------------------------------------------------------------------
// safe:sign
// ---------------------------------------------------------------------------

task("safe:sign", "Attach signatures to a bundle (local key, or import external sigs)")
  .addParam("name", "Bundle name")
  .addOptionalParam(
    "keyEnv",
    "Env var holding a private key to sign with (e.g. SAFE_SIGNER_KEY)",
  )
  .addOptionalParam("import", "Path to a JSON file of {safeTxHash, signer, signature} entries")
  .setAction(async (taskArgs) => {
    assertOkuSafeConfig();
    const bundle = readBundle(String(taskArgs.name));
    const owners = new Set(bundle.owners.map((o) => getAddress(o)));
    const existing = readSidecars(bundle.name);
    const collected: SignatureEntry[] = [];

    let added = 0;
    let skipped = 0;

    if (taskArgs.keyEnv) {
      const key = process.env[String(taskArgs.keyEnv)];
      if (!key) throw new Error(`env var ${taskArgs.keyEnv} is not set`);
      const wallet = new Wallet(key.startsWith("0x") ? key : `0x${key}`);
      const signer = getAddress(wallet.address);
      if (!owners.has(signer)) {
        throw new Error(
          `${signer} is not a Safe owner. Owners: ${[...owners].join(", ")}`,
        );
      }
      console.log(`\nSigning bundle "${bundle.name}" as ${signer}`);
      for (const c of bundle.chains) {
        // Recompute rather than trusting the stored hash: a tampered bundle
        // must not be able to get a signature over a different payload.
        const tx = deserializeTx(c.tx);
        const localHash = hashSafeTx(c.chainId, bundle.safe, tx);
        if (localHash !== c.safeTxHash) {
          throw new Error(
            `bundle integrity failure on ${c.network}: stored hash ${c.safeTxHash} ` +
              `!= recomputed ${localHash}. Refusing to sign.`,
          );
        }
        if (signaturesFor(bundle, c, existing).some((s) => s.signer === signer)) {
          skipped++;
          continue;
        }
        const signature = await wallet.signTypedData(
          safeDomain(c.chainId, bundle.safe),
          SAFE_TX_TYPES,
          tx,
        );
        if (recoverSafeTxSigner(localHash, signature) !== signer) {
          throw new Error(`self-check failed: signature does not recover to ${signer}`);
        }
        collected.push({ safeTxHash: localHash, signer, signature });
        added++;
        console.log(`  ✓ ${pad(c.network, 12)} ${localHash.slice(0, 18)}…`);
      }
    }

    if (taskArgs.import) {
      const raw = JSON.parse(fs.readFileSync(String(taskArgs.import), "utf8")) as {
        safeTxHash: string;
        signer: string;
        signature: string;
      }[];
      console.log(`\nImporting ${raw.length} signature(s) into "${bundle.name}"`);
      for (const entry of raw) {
        const target = bundle.chains.find(
          (c) => c.safeTxHash.toLowerCase() === entry.safeTxHash.toLowerCase(),
        );
        if (!target) {
          console.log(`  ⚠ no chain in bundle matches hash ${entry.safeTxHash}`);
          continue;
        }
        // Recover rather than trust the claimed signer.
        const recovered = recoverSafeTxSigner(target.safeTxHash, entry.signature);
        if (!owners.has(recovered)) {
          console.log(
            `  ✗ ${pad(target.network, 12)} signature recovers to ${recovered}, not an owner`,
          );
          continue;
        }
        if (entry.signer && getAddress(entry.signer) !== recovered) {
          console.log(
            `  ✗ ${pad(target.network, 12)} claimed signer ${getAddress(entry.signer)} ` +
              `but recovered ${recovered}`,
          );
          continue;
        }
        if (signaturesFor(bundle, target, existing).some((s) => s.signer === recovered)) {
          skipped++;
          continue;
        }
        collected.push({
          safeTxHash: target.safeTxHash,
          signer: recovered,
          signature: entry.signature,
        });
        added++;
        console.log(`  ✓ ${pad(target.network, 12)} from ${recovered}`);
      }
    }

    if (!taskArgs.keyEnv && !taskArgs.import) {
      throw new Error("provide --key-env or --import");
    }

    // Signatures go into per-signer sidecars, never into the bundle -- that
    // is what keeps the bundle committable. See the Signature storage note.
    if (collected.length) writeSidecar(bundle.name, collected);
    const all = readSidecars(bundle.name);
    const count = (c: BundleChain) => signaturesFor(bundle, c, all).length;
    const ready = bundle.chains.filter((c) => count(c) >= bundle.threshold).length;
    console.log("\n" + "-".repeat(96));
    console.log(`added ${added}, skipped ${skipped} (already signed)`);
    if (collected.length) {
      const signers = [...new Set(collected.map((c) => c.signer))];
      for (const s of signers) {
        console.log(`  written to ${path.relative(process.cwd(), sidecarFile(bundle.name, s))}`);
      }
    }
    console.log(
      `${ready}/${bundle.chains.length} chains now have the ${bundle.threshold} ` +
        `signature(s) needed to execute`,
    );
    if (ready < bundle.chains.length) {
      const short = bundle.chains
        .filter((c) => count(c) < bundle.threshold)
        .map((c) => `${c.network}(${count(c)}/${bundle.threshold})`);
      console.log(`still short: ${short.join(", ")}`);
    }
    console.log("");
  });

// ---------------------------------------------------------------------------
// safe:exec
// ---------------------------------------------------------------------------

task("safe:exec", "Broadcast a signed bundle from the hot relayer (DRY RUN unless --broadcast)")
  .addParam("name", "Bundle name")
  .addOptionalParam("networks", "Comma-separated list of networks to restrict to")
  .addFlag("broadcast", "Actually send transactions (default is a dry run)")
  .addFlag("fromService", "Fetch collected signatures from Safe's Transaction Service")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    assertOkuSafeConfig();
    const bundle = readBundle(String(taskArgs.name));
    const broadcast: boolean = taskArgs.broadcast;
    const only = taskArgs.networks
      ? new Set<string>(
          String(taskArgs.networks)
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean),
        )
      : undefined;

    const allChains = listSafeChains(hre);
    const byNetwork = new Map(allChains.map((c) => [c.network, c]));
    // Signatures live in per-signer sidecars alongside the bundle.
    const sidecars = readSidecars(bundle.name);

    console.log("\n" + "=".repeat(96));
    console.log(
      broadcast
        ? `SAFE EXEC  "${bundle.name}"  *** BROADCAST ***`
        : `SAFE EXEC  "${bundle.name}"  [DRY RUN]`,
    );
    console.log("=".repeat(96));
    console.log(`Safe      : ${bundle.safe}  (${bundle.threshold} of ${bundle.owners.length})`);
    console.log(`Relayer   : ${OKU_DEPLOYER_EOA}  (needs no permissions, pays all gas)`);
    console.log(`Intent    : ${bundle.intent}`);

    const targets = bundle.chains.filter((c) => !only || only.has(c.network));
    let ok = 0;
    let failed = 0;
    let skipped = 0;

    for (const c of targets) {
      const chain = byNetwork.get(c.network);
      if (!chain?.rpcUrl) {
        console.log(`\n=== ${c.network}: skip (NO_RPC)`);
        skipped++;
        continue;
      }
      const provider = makeProvider(chain.rpcUrl, chain.chainId);
      try {
        const tx = deserializeTx(c.tx);

        // Integrity: recompute the hash from the stored fields.
        const localHash = hashSafeTx(c.chainId, bundle.safe, tx);
        if (localHash !== c.safeTxHash) {
          console.log(`\n=== ${c.network}: ✗ bundle integrity failure (hash mismatch)`);
          failed++;
          continue;
        }

        // The Safe nonce must still match, otherwise the signatures are
        // stale -- another transaction has executed in the meantime.
        const nonceRaw = await withRetry(
          () =>
            provider.call({ to: bundle.safe, data: SAFE_IFACE.encodeFunctionData("nonce") }),
          `${c.network}:safe.nonce()`,
        );
        const liveNonce = SAFE_IFACE.decodeFunctionResult("nonce", nonceRaw)[0] as bigint;
        if (liveNonce !== tx.nonce) {
          console.log(
            `\n=== ${c.network}: ✗ STALE — Safe nonce is now ${liveNonce}, bundle signed for ` +
              `${tx.nonce}. Rebuild and re-sign.`,
          );
          failed++;
          continue;
        }

        let sigs = signaturesFor(bundle, c, sidecars);
        if (taskArgs.fromService) {
          const fetched = await fetchServiceSignatures(c, bundle);
          if (fetched.length) {
            console.log(`\n=== ${c.network}: pulled ${fetched.length} signature(s) from tx service`);
            const merged = [...sigs];
            const persist: SignatureEntry[] = [];
            for (const f of fetched) {
              if (!merged.some((s) => getAddress(s.signer) === getAddress(f.signer))) {
                merged.push(f);
                persist.push({
                  safeTxHash: c.safeTxHash,
                  signer: getAddress(f.signer),
                  signature: f.signature,
                });
              }
            }
            // Cache them in the sidecar so a re-run does not depend on the
            // hosted service being reachable.
            if (persist.length) writeSidecar(bundle.name, persist);
            sigs = merged;
          }
        }

        if (sigs.length < bundle.threshold) {
          console.log(
            `\n=== ${c.network}: skip — ${sigs.length}/${bundle.threshold} signatures`,
          );
          skipped++;
          continue;
        }

        // Validate every signature locally before spending gas.
        const owners = new Set(bundle.owners.map((o) => getAddress(o)));
        const validated: { signer: string; signature: string }[] = [];
        let bad = false;
        for (const s of sigs) {
          const recovered = recoverSafeTxSigner(localHash, s.signature);
          if (!owners.has(recovered)) {
            console.log(`\n=== ${c.network}: ✗ signature recovers to non-owner ${recovered}`);
            bad = true;
            break;
          }
          validated.push({ signer: recovered, signature: s.signature });
        }
        if (bad) {
          failed++;
          continue;
        }

        const packed = packSignatures(validated.slice(0, Math.max(bundle.threshold, validated.length)));
        const execData = SAFE_IFACE.encodeFunctionData("execTransaction", [
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
          tx.safeTxGas,
          tx.baseGas,
          tx.gasPrice,
          tx.gasToken,
          tx.refundReceiver,
          packed,
        ]);

        // Simulate the real execTransaction with the real signatures. This is
        // a complete end-to-end proof: signature checks, threshold, nonce and
        // the inner call all run.
        try {
          const res = await withRetry(
            () =>
              provider.call({ from: OKU_DEPLOYER_EOA, to: bundle.safe, data: execData }),
            `${c.network}:simulate execTransaction`,
          );
          const [success] = SAFE_IFACE.decodeFunctionResult("execTransaction", res);
          if (!success) {
            console.log(`\n=== ${c.network}: ✗ execTransaction would return false (inner revert)`);
            failed++;
            continue;
          }
        } catch (e) {
          const anyE = e as { data?: string; shortMessage?: string; message?: string };
          const reason = anyE.data ? decodeRevert(anyE.data) : undefined;
          console.log(
            `\n=== ${c.network}: ✗ simulation failed: ${reason ?? anyE.shortMessage ?? anyE.message}`,
          );
          failed++;
          continue;
        }

        if (!broadcast) {
          console.log(
            `\n=== ${c.network}: ✓ [dry run] would execute — ${c.calls.length} call(s), ` +
              `${validated.length} sig(s), nonce ${tx.nonce}`,
          );
          c.calls.forEach((call) => console.log(`      ${call.label}`));
          ok++;
          continue;
        }

        const key = resolveDeployerKey(hre, c.network);
        if (!key) {
          console.log(`\n=== ${c.network}: skip (NO_KEY)`);
          skipped++;
          continue;
        }
        const wallet = new Wallet(key, provider);
        const overrides = gasOverrides(chain);
        let gasLimit: bigint;
        try {
          const est = await provider.estimateGas({
            from: wallet.address,
            to: bundle.safe,
            data: execData,
          });
          gasLimit = (est * 140n) / 100n;
        } catch {
          gasLimit = 2_000_000n;
        }
        const sent = await withRetry(
          () =>
            wallet.sendTransaction({
              to: bundle.safe,
              data: execData,
              gasLimit,
              ...overrides,
            }),
          `${c.network}:execTransaction`,
        );
        const receipt = await confirmTx(provider, sent.hash);
        console.log(
          `\n=== ${c.network}: ✓ executed [tx ${sent.hash}] block ${receipt?.blockNumber}`,
        );
        c.calls.forEach((call) => console.log(`      ${call.label}`));
        ok++;

        // A sweep is irreversible and its amounts are only knowable from the
        // chain, so capture the record immediately. Failure to write the
        // artifact must never be reported as a failure to execute -- the funds
        // have already moved -- hence the isolated catch and the explicit
        // instruction for regenerating it.
        if (bundle.intent === "sweep" && c.sweep) {
          try {
            const report = await accountForSweepTx({
              provider,
              network: c.network,
              chainId: c.chainId,
              router: c.router,
              safe: bundle.safe,
              recipient: c.sweep.recipient,
              txHash: sent.hash,
              mode: "execution",
              bundle: bundle.name,
              safeNonce: c.nonce,
              safeTxHash: c.safeTxHash,
              signers: sigs.map((s) => getAddress(s.signer)),
            });
            const written = writeAccounting(report);
            console.log(`      accounting: ${written.json}`);
            try {
              const listed = new Set(
                (loadFeeTokens().chains[String(c.chainId)]?.tokens ?? []).map((t) => t.address),
              );
              const unlisted = report.assets
                .filter((a) => a.token !== NATIVE_SENTINEL && !listed.has(getAddress(a.token)))
                .map((a) => `${a.symbol} ${a.token}`);
              if (unlisted.length) {
                console.log(
                  `      NOTE: swept token(s) not in data/fee-tokens.json -- add them with ` +
                    `fees:audit --write --networks ${c.network}: ${unlisted.join(", ")}`,
                );
              }
            } catch {
              /* no curated list yet: nothing to compare against */
            }
            if (!report.reconciliation.allRouterBalancesZero) {
              console.log(`      WARNING: router still holds a balance for a swept asset`);
            }
            if (!report.reconciliation.eventsMatchBalanceDeltas) {
              console.log(`      WARNING: emitted amounts != measured recipient deltas`);
            }
          } catch (e) {
            console.log(
              `      accounting FAILED to write: ` +
                `${String((e as { message?: string }).message ?? e).slice(0, 100)}\n` +
                `      The sweep itself succeeded. Regenerate with:\n` +
                `        npx hardhat fees:account --network-name ${c.network} ` +
                `--tx ${sent.hash} --name ${bundle.name}`,
            );
          }
        }
      } catch (e) {
        const anyE = e as { shortMessage?: string; message?: string };
        console.log(`\n=== ${c.network}: ✗ ${anyE.shortMessage ?? anyE.message ?? e}`);
        failed++;
      } finally {
        provider.destroy();
      }
    }


    console.log("\n" + "-".repeat(96));
    console.log(
      `${broadcast ? "executed" : "would execute"}: ${ok}   skipped: ${skipped}   failed: ${failed}`,
    );
    if (failed) process.exitCode = 1;
    if (!broadcast && ok) {
      console.log(`\nNothing was sent. Re-run with --broadcast to execute.`);
    }
    console.log("");
  });

/**
 * Pull owner confirmations for this exact safeTxHash out of Safe's hosted
 * Transaction Service.
 *
 * This is what lets owners sign in app.safe.global with a hardware wallet
 * while the hot relayer still pays the gas: the UI stores confirmations
 * off-chain, and we fetch and submit them ourselves.
 */
async function fetchServiceSignatures(
  c: BundleChain,
  bundle: Bundle,
): Promise<{ signer: string; signature: string }[]> {
  const base = safeTxServiceUrl(c.chainId);
  if (!base) return [];
  try {
    const res = await fetch(`${base}/v1/multisig-transactions/${c.safeTxHash}/`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      confirmations?: { owner: string; signature: string }[];
    };
    const owners = new Set(bundle.owners.map((o) => getAddress(o)));
    return (j.confirmations ?? [])
      .filter((cf) => cf.signature && owners.has(getAddress(cf.owner)))
      .map((cf) => ({ signer: getAddress(cf.owner), signature: cf.signature }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// safe:status
// ---------------------------------------------------------------------------

task("safe:status", "Per-chain Safe and OkuRouter ownership state, or a bundle's signing progress")
  .addOptionalParam("networks", "Comma-separated list of networks to restrict to")
  .addOptionalParam("name", "Bundle name: show per-chain signature progress and nonce freshness instead")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    assertOkuSafeConfig();
    const dep = getOkuSafeDeployment();
    if (taskArgs.name) {
      await bundleProgress(hre, String(taskArgs.name), taskArgs.networks ? String(taskArgs.networks) : undefined);
      return;
    }
    const only = taskArgs.networks
      ? new Set<string>(
          String(taskArgs.networks)
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean),
        )
      : undefined;
    const chains = listSafeChains(hre, only);

    console.log("\n" + "=".repeat(96));
    console.log(`SAFE STATUS   safe=${dep.address}`);
    console.log("=".repeat(96));
    console.log(
      pad("network", 12) +
        pad("chainId", 9) +
        pad("safe", 14) +
        pad("nonce", 8) +
        pad("thr", 5) +
        pad("routerOwner", 14) +
        pad("paused", 8) +
        pad("txSvc", 7),
    );
    console.log("-".repeat(96));

    const rows = await mapLimit(chains, 6, async (chain) => {
      const r = {
        network: chain.network,
        safe: "-",
        nonce: "-",
        thr: "-",
        owner: "-",
        paused: "-",
        svc: hasSafeTxService(chain.chainId) ? "yes" : "no",
      };
      if (!chain.rpcUrl) return { ...r, safe: "NO_RPC" };
      const provider = makeProvider(chain.rpcUrl, chain.chainId);
      try {
        const code = await provider.getCode(dep.address);
        if (code === "0x") {
          r.safe = "not-deployed";
        } else {
          r.safe = "deployed";
          const call = async (fn: string) =>
            SAFE_IFACE.decodeFunctionResult(
              fn,
              await provider.call({
                to: dep.address,
                data: SAFE_IFACE.encodeFunctionData(fn),
              }),
            )[0];
          r.nonce = String(await call("nonce"));
          r.thr = String(await call("getThreshold"));
        }
        if (chain.router) {
          const router = OkuRouter__factory.connect(chain.router, provider);
          const [owner, paused] = await Promise.all([router.owner(), router.paused()]);
          const o = getAddress(owner);
          r.owner =
            o === getAddress(dep.address)
              ? "SAFE"
              : o === getAddress(OKU_DEPLOYER_EOA)
                ? "deployer"
                : o.slice(0, 12);
          r.paused = paused ? "PAUSED" : "no";
        }
      } catch {
        r.safe = "ERR";
      } finally {
        provider.destroy();
      }
      return r;
    });

    for (const [i, r] of rows.entries()) {
      console.log(
        pad(r.network, 12) +
          pad(chains[i].chainId, 9) +
          pad(r.safe, 14) +
          pad(r.nonce, 8) +
          pad(r.thr, 5) +
          pad(r.owner, 14) +
          pad(r.paused, 8) +
          pad(r.svc, 7),
      );
    }
    const owned = rows.filter((r) => r.owner === "SAFE").length;
    console.log("-".repeat(96));
    console.log(
      `Safe deployed on ${rows.filter((r) => r.safe === "deployed").length}/${rows.length}, ` +
        `owns the router on ${owned}/${rows.length}`,
    );
    console.log("");
  });

/**
 * Signature progress for one bundle: who has signed each chain (recovered,
 * not claimed), whether it is at threshold, and whether the bundle nonce is
 * still the Safe's live nonce (anything else executed => signatures are dead).
 */
async function bundleProgress(hre: HardhatRuntimeEnvironment, name: string, networks?: string) {
  const bundle = readBundle(name);
  const sidecars = readSidecars(name);
  const only = networks ? new Set(networks.split(",").map((s) => s.trim())) : undefined;
  const chains = listSafeChains(hre);
  const owners = bundle.owners.map((o) => getAddress(o));
  const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

  console.log("\n" + "=".repeat(96));
  console.log(`BUNDLE STATUS  "${name}"  intent=${bundle.intent}  ${bundle.threshold} of ${owners.length}`);
  console.log("=".repeat(96));
  console.log(pad("network", 12) + pad("nonce", 7) + pad("live", 7) + pad("sigs", 6) + owners.map((o) => pad(short(o), 14)).join("") + "state");
  console.log("-".repeat(96));

  const rows = await mapLimit(
    bundle.chains.filter((c) => !only || only.has(c.network)),
    6,
    async (c) => {
      const valid = new Set<string>();
      for (const s of signaturesFor(bundle, c, sidecars)) {
        try {
          const rec = recoverSafeTxSigner(c.safeTxHash, s.signature);
          if (getAddress(rec) === s.signer) valid.add(s.signer);
        } catch {
          /* unrecoverable: not counted */
        }
      }
      let live = "?";
      const sc = chains.find((x) => x.network === c.network);
      if (sc?.rpcUrl) {
        const provider = makeProvider(sc.rpcUrl, c.chainId);
        try {
          const raw = await provider.call({ to: bundle.safe, data: SAFE_IFACE.encodeFunctionData("nonce") });
          live = String(SAFE_IFACE.decodeFunctionResult("nonce", raw)[0]);
        } catch {
          live = "ERR";
        } finally {
          provider.destroy();
        }
      }
      const state =
        live !== "?" && live !== "ERR" && BigInt(live) > BigInt(c.nonce)
          ? "EXECUTED/STALE"
          : live !== "?" && live !== "ERR" && BigInt(live) < BigInt(c.nonce)
            ? "WAITING (earlier nonce pending)"
            : valid.size >= bundle.threshold
              ? "READY"
              : `needs ${bundle.threshold - valid.size}`;
      return { c, valid, live, state };
    },
  );
  for (const r of rows) {
    console.log(
      pad(r.c.network, 12) + pad(r.c.nonce, 7) + pad(r.live, 7) + pad(`${r.valid.size}/${bundle.threshold}`, 6) +
        owners.map((o) => pad(r.valid.has(o) ? "  ✓" : "  ·", 14)).join("") + r.state,
    );
  }
  console.log("-".repeat(96));
  const ready = rows.filter((r) => r.state === "READY").length;
  console.log(`${ready}/${rows.length} chain(s) ready to execute`);
  console.log("");
}
