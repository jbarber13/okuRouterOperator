/**
 * feeScan.ts
 *
 * Discovery and valuation of idle protocol fees sitting on an OkuRouter.
 *
 * The router has NO fee accounting. Fees are not tracked in any state
 * variable or mapping -- they simply accumulate as the contract's own token
 * and ETH balance:
 *   - token -> token : fee is withheld from the INPUT token (the router pulls
 *                      `sellAmount` but only approves `sellAmount - feeAmount`)
 *   - ETH   -> token : fee is withheld from msg.value
 *   - token -> ETH   : fee is taken out of the output ETH
 *
 * So every ERC20 the router holds arrived as somebody's `tokenIn`, and the
 * only way to know what is collectable is to read `balanceOf(router)`.
 *
 * HOW DISCOVERY WORKS NOW
 *
 * By asking. A candidate set is assembled from Oku's published token list, a
 * committed seed of assets previously observed, and chain-config's well-known
 * tokens; every candidate's balance is then read in one batched Multicall3
 * round. See util/tokenUniverse.ts and util/balanceProbe.ts.
 *
 * This replaced walking `OrderFilled` history with eth_getLogs. That worked,
 * but it made discovery hostage to whatever block range an endpoint felt like
 * serving -- a cap that is undiscoverable except by being rejected, and which
 * on 2026-09-29 silently reduced arbitrum to zero assets while the router held
 * 34. The trade is explicit and is documented in tokenUniverse.ts: the
 * candidate set cannot contain a token nobody ever listed, so a token traded
 * only by direct contract call may be missed. `scripts/dryRunDiscovery.ts`
 * measures that gap against real logs.
 *
 * HOW VALUATION WORKS NOW
 *
 * DefiLlama, and nothing else. Previously this module derived prices from
 * Uniswap V3 pool state, which had the virtue of needing no key -- and the
 * defect that a pool holding dust still quotes a price. That produced a
 * $2.1e50 line item from a token quoted against $1.25 of liquidity. Deriving
 * prices from reserves is gone, and with it that entire class of failure.
 *
 * What went with it is the LIQUIDITY signal: there is no longer a
 * `poolDepthUsd`, and therefore no `realizableUsd`. Totals are notional only.
 * Nothing here can tell you whether an asset can actually be exited into.
 */
import type { JsonRpcProvider } from "ethers";
import { Interface, formatUnits } from "ethers";
import type { NetworkConfig } from "./deploymentConfig";
import { toChecksum } from "./address";
import { fetchLlamaPrices, llamaSlug } from "./priceLlama";
import {
  multicallAddressFor,
  probeBalances,
  probeMetadata,
  type BalanceProbeProvider,
} from "./balanceProbe";

/** Pseudo-address used to represent the chain's native asset in asset lists. */
export const NATIVE_SENTINEL = "native";

const ERC20_IFACE = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/**
 * Re-exported from util/address.ts, which is where the implementation and its
 * EIP-1191 rationale live. Kept exported here so existing importers do not
 * have to move.
 */
export { toChecksum };

export interface FeeAsset {
  /** Checksummed ERC20 address, or NATIVE_SENTINEL. */
  token: string;
  symbol: string;
  decimals: number;
  balance: bigint;
}

export interface PricedFeeAsset extends FeeAsset {
  usdPrice?: number;
  usdValue?: number;
  /** e.g. "llama:0.99", "llama-historical", or "unpriced:no-source". */
  priceSource?: string;
}

export interface FeeScanResult {
  router: string;
  assets: PricedFeeAsset[];
  /** Candidate addresses submitted to the balance probe. */
  candidates: number;
  /** eth_calls the probe and metadata reads cost. */
  calls: number;
  /** Candidates the probe could not check. NOT evidence of a zero balance. */
  unchecked: number;
  /** Non-fatal problems worth surfacing. */
  warnings: string[];
}

/**
 * Read symbol/decimals/balance one token at a time, keeping non-zero ones.
 *
 * This is the FALLBACK path, used only where Multicall3 is unavailable. It
 * costs three sequential round trips per token (the provider runs with
 * batching disabled), so callers must hand it a small set -- chain-config's
 * well-known tokens, not a full candidate universe.
 */
export async function readNonZeroBalances(
  provider: JsonRpcProvider,
  router: string,
  candidates: Iterable<string>,
): Promise<FeeAsset[]> {
  const out: FeeAsset[] = [];
  for (const raw of candidates) {
    const token = toChecksum(raw);
    if (!token) continue;
    try {
      const balRaw = await provider.call({
        to: token,
        data: ERC20_IFACE.encodeFunctionData("balanceOf", [router]),
      });
      const balance = BigInt(balRaw);
      if (balance === 0n) continue;

      const decRaw = await provider.call({
        to: token,
        data: ERC20_IFACE.encodeFunctionData("decimals", []),
      });
      const decimals = Number(BigInt(decRaw));

      let symbol = "?";
      try {
        const symRaw = await provider.call({
          to: token,
          data: ERC20_IFACE.encodeFunctionData("symbol", []),
        });
        symbol = ERC20_IFACE.decodeFunctionResult("symbol", symRaw)[0] as string;
      } catch {
        // Non-standard tokens (bytes32 symbol, or none) still sweep fine.
      }
      out.push({ token, symbol, decimals, balance });
    } catch {
      // Not a readable ERC20 at this address; nothing to sweep.
    }
  }
  return out;
}

/**
 * Normalize a ticker for native-vs-wrapped comparison: "WETH" -> "ETH",
 * "WAVAX" -> "AVAX", "CELO" -> "CELO".
 */
function bareSymbol(s: string): string {
  return s.trim().toUpperCase().replace(/^W/, "");
}

/**
 * Does `token` look like the wrapped form of `nativeSymbol`?
 *
 * Returns false if the symbol cannot be read. A non-standard token that will
 * not answer symbol() is not evidence that it wraps the native asset, and
 * guessing yes is how a chain ends up valuing its gas token as ether.
 */
export async function symbolMatchesNative(
  provider: JsonRpcProvider,
  token: string,
  nativeSymbol: string,
): Promise<boolean> {
  if (!nativeSymbol) return false;
  try {
    const raw = await provider.call({
      to: token,
      data: ERC20_IFACE.encodeFunctionData("symbol", []),
    });
    const sym = ERC20_IFACE.decodeFunctionResult("symbol", raw)[0] as string;
    return bareSymbol(sym) === bareSymbol(nativeSymbol);
  } catch {
    return false;
  }
}

/**
 * The wrapped form of this chain's native asset, per chain-config.
 *
 * `oku.pricing.nativeWrappedToken` is the correct field and `token.wethAddress`
 * is NOT: on Polygon the latter is bridged WETH while the native asset is POL,
 * and conflating them once priced 9.6 POL at $26,447. The former is WPOL, as
 * it should be.
 *
 * Note also what is deliberately NOT used here: `oracles.coingecko.native`.
 * chain-config records it as "ethereum" for celo, whose native asset is CELO.
 * Trusting it would value CELO at $2,680 instead of $0.098 -- a 27,000x
 * overstatement of a live balance, which is the same failure in a new costume.
 */
function nativeWrappedToken(cfg: NetworkConfig): string | undefined {
  const pricing = (cfg.chain as unknown as {
    oku?: { pricing?: { nativeWrappedToken?: string } };
  }).oku?.pricing;
  return toChecksum(pricing?.nativeWrappedToken);
}

/**
 * Attach USD valuations from DefiLlama.
 *
 * ERC20s are priced by address on their own chain. The native asset is priced
 * through its WRAPPED form, but only after confirming on chain that the
 * wrapped token really is the wrapped native -- see nativeWrappedToken above
 * for why that check is not optional.
 *
 * Assets with no quote are left unpriced rather than assigned zero, so
 * "unknown" stays distinguishable from "worthless".
 */
export async function priceAssets(
  provider: JsonRpcProvider,
  cfg: NetworkConfig,
  assets: FeeAsset[],
  opts: {
    /** Unix seconds; price as of a past moment instead of now. */
    at?: number;
  } = {},
): Promise<{ priced: PricedFeeAsset[]; nativeUsd: number | null; warnings: string[] }> {
  const warnings: string[] = [];
  const priced: PricedFeeAsset[] = assets.map((a) => ({ ...a }));

  if (!llamaSlug(cfg.networkName)) {
    warnings.push(
      `${cfg.networkName}: no DefiLlama coverage for this chain; all assets are unpriced`,
    );
    for (const a of priced) a.priceSource = "unpriced:no-source";
    return { priced, nativeUsd: null, warnings };
  }

  const wants = new Set<string>();
  for (const a of priced) {
    if (a.token !== NATIVE_SENTINEL) wants.add(a.token);
  }

  // ---- native asset: resolve its wrapped form, and verify it ----
  const hasNative = priced.some((a) => a.token === NATIVE_SENTINEL);
  let wrapped: string | undefined;
  if (hasNative) {
    wrapped = nativeWrappedToken(cfg);
    if (!wrapped) {
      warnings.push(
        `${cfg.networkName}: no oku.pricing.nativeWrappedToken in chain-config, so the ` +
          `native balance is left unpriced rather than guessed.`,
      );
    } else if (!(await symbolMatchesNative(provider, wrapped, cfg.nativeSymbol))) {
      warnings.push(
        `${cfg.networkName}: ${wrapped} does not report a symbol matching ` +
          `${cfg.nativeSymbol}, so it is not treated as the wrapped native asset and the ` +
          `native balance is left unpriced.`,
      );
      wrapped = undefined;
    } else {
      wants.add(wrapped);
    }
  }

  if (wants.size === 0) return { priced, nativeUsd: null, warnings };

  const res = await fetchLlamaPrices(cfg.networkName, wants, { at: opts.at });
  warnings.push(...res.warnings);

  const nativeQuote = wrapped ? res.prices.get(wrapped) : undefined;
  const nativeUsd = nativeQuote ? nativeQuote.price : null;

  let unpriced = 0;
  for (const a of priced) {
    const quote =
      a.token === NATIVE_SENTINEL ? nativeQuote : res.prices.get(toChecksum(a.token) ?? a.token);
    if (!quote) {
      a.priceSource = "unpriced:no-source";
      unpriced++;
      continue;
    }
    a.usdPrice = quote.price;
    a.usdValue = Number(formatUnits(a.balance, a.decimals)) * quote.price;
    a.priceSource = quote.historical
      ? `llama-historical@${quote.timestamp}`
      : `llama:${quote.confidence.toFixed(2)}`;
  }

  if (unpriced > 0) {
    warnings.push(
      `${cfg.networkName}: ${unpriced} asset(s) have no DefiLlama quote and are reported ` +
        `unpriced, contributing $0 to the totals.`,
    );
  }

  return { priced, nativeUsd, warnings };
}

/**
 * Full idle-fee picture for one chain: probe balances, read metadata, price.
 *
 * `candidates` is the token universe to ask about -- built by the caller via
 * util/tokenUniverse.ts and shared across chains, because the published list
 * is ~8 MB and re-parsing it per chain would cost more than the probe.
 *
 * `includeNative` is implicit: the router's own ETH balance is appended as a
 * synthetic asset so callers can present one list. `sweepAll` takes native via
 * its `includeEth` flag rather than an array entry, so callers must NOT pass
 * the sentinel into a tokens array.
 */
export async function scanChainFees(
  provider: JsonRpcProvider,
  cfg: NetworkConfig,
  router: string,
  opts: {
    candidates: Iterable<string>;
    /** USD valuation. Default true. */
    price?: boolean;
    /** Unix seconds; price as of a past moment instead of now. */
    at?: number;
  },
): Promise<FeeScanResult> {
  const warnings: string[] = [];
  const multicall = multicallAddressFor(cfg);

  const probe = await probeBalances(
    provider as unknown as BalanceProbeProvider,
    router,
    opts.candidates,
    { multicall },
  );
  warnings.push(...probe.warnings);

  let assets: FeeAsset[] = [];
  let calls = probe.calls;

  if (probe.available) {
    const { meta, calls: metaCalls, warnings: metaWarnings } = await probeMetadata(
      provider as unknown as BalanceProbeProvider,
      probe.balances.keys(),
      { multicall },
    );
    calls += metaCalls;
    warnings.push(...metaWarnings);
    for (const [token, balance] of probe.balances) {
      const m = meta.get(token);
      // No decimals means no way to interpret the amount. Reported, not
      // guessed -- see probeMetadata.
      if (!m) continue;
      assets.push({ token, symbol: m.symbol, decimals: m.decimals, balance });
    }
  } else {
    // No Multicall3 here. Fall back to sequential reads over the WELL-KNOWN
    // tokens only: the full candidate set would be thousands of round trips,
    // and this degradation needs to be survivable rather than merely correct.
    const known = new Set<string>();
    const chainTokens = (cfg.chain as unknown as { token?: Record<string, string | undefined> })
      .token;
    for (const v of [
      ...Object.values(chainTokens ?? {}),
      cfg.wethAddress,
      cfg.usdcAddress,
      nativeWrappedToken(cfg),
    ]) {
      const a = toChecksum(v);
      if (a) known.add(a);
    }
    warnings.push(
      `${cfg.networkName}: Multicall3 unavailable, so only ${known.size} well-known token(s) ` +
        `were checked. Anything else the router holds is INVISIBLE to this scan.`,
    );
    assets = await readNonZeroBalances(provider, router, known);
    calls += known.size * 3;
  }

  const nativeBal = await provider.getBalance(router);
  calls++;
  if (nativeBal > 0n) {
    assets.push({
      token: NATIVE_SENTINEL,
      symbol: cfg.nativeSymbol,
      decimals: 18,
      balance: nativeBal,
    });
  }

  if (opts.price === false) {
    return {
      router,
      assets,
      candidates: probe.probed,
      calls,
      unchecked: probe.unchecked,
      warnings,
    };
  }

  const { priced, warnings: priceWarnings } = await priceAssets(provider, cfg, assets, {
    at: opts.at,
  });
  warnings.push(...priceWarnings);
  priced.sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1));

  return {
    router,
    assets: priced,
    candidates: probe.probed,
    calls,
    unchecked: probe.unchecked,
    warnings,
  };
}

/**
 * Sum helper used by both the scan task and the accounting report.
 *
 * `unpriced` is part of the return value rather than something callers may
 * compute if they remember to. Summing with `?? 0` silently turns "we could
 * not value this" into "this is worth nothing", and on the 2026-09-30 scan
 * that made eleven chains report exactly "$0.00" while holding 173 unvalued
 * assets between them -- a total that reads as "nothing here" when it means
 * "we do not know". Anything rendering these figures must be able to say how
 * many assets are behind them.
 */
export function totalUsd(assets: PricedFeeAsset[]): { notional: number; unpriced: number } {
  let notional = 0;
  let unpriced = 0;
  for (const a of assets) {
    if (a.usdValue === undefined) unpriced++;
    else notional += a.usdValue;
  }
  return { notional, unpriced };
}

/** Human-readable amount, for tables and the accounting markdown. */
export function fmtAmount(a: { balance: bigint; decimals: number }): string {
  return formatUnits(a.balance, a.decimals);
}
