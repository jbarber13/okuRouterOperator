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
 * only by direct contract call may be missed. Callers now pass the curated
 * data/fee-tokens.json as candidates; `fees:audit` checks the wider set.
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
import { fetchLlamaByKeys, fetchLlamaPrices, llamaSlug, MIN_CONFIDENCE } from "./priceLlama";
import { fetchGeckoPrices, FIRM_MIN_LIQUIDITY_USD } from "./priceGecko";
import { loadFeeTokens, priceAliasesFor, type FeeTokensFile } from "./feeTokens";
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

/**
 * firm: counted in totals and --min-usd.
 * thin: a real quote from a low-liquidity pool or a low-confidence aggregate;
 *       shown, never summed into a total.
 */
export type PriceTier = "firm" | "thin";

export interface PricedFeeAsset extends FeeAsset {
  usdPrice?: number;
  /** FIRM valuations only. Anything summing this gets firm-only totals for free. */
  usdValue?: number;
  /** THIN valuations only: shown beside totals, never inside them. */
  usdValueThin?: number;
  priceTier?: PriceTier;
  /** Pool reserve behind a DEX price, when the source reports one. */
  liquidityUsd?: number;
  /**
   * e.g. "llama:0.99", "llama-historical@<ts>", "alias:coingecko:celo",
   * "gecko:$1.2M", or "unpriced:no-market" / "unpriced:no-source" /
   * "unpriced:source-error".
   */
  priceSource?: string;
}

/** Lowest DefiLlama confidence kept at all (as thin). Below MIN_CONFIDENCE is thin. */
export const THIN_MIN_CONFIDENCE = 0.7;

/**
 * GeckoTerminal has no simple historical price, so for a past `at` its CURRENT
 * price is only used when `at` is this recent -- which covers safe:exec, whose
 * accounting runs seconds after the transaction.
 */
export const GECKO_CURRENT_FOR_PAST_SEC = 3_600;

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

interface Quote {
  price: number;
  tier: PriceTier;
  source: string;
  liquidityUsd?: number;
}

function fmtLiq(n: number): string {
  return n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;
}

/**
 * Attach USD valuations, trying sources in order and tagging each price with
 * a tier (see PriceTier):
 *
 *   1. reviewed alias (`priceAs` / `nativePriceAs` in data/fee-tokens.json),
 *      priced through DefiLlama's coingecko: keys -- firm
 *   2. DefiLlama by address: confidence >= 0.9 firm; 0.7-0.9 kept as a thin
 *      fallback
 *   3. GeckoTerminal DEX price: pool reserve >= $10k firm, else thin
 *      (a thin DefiLlama quote is preferred over a thin DEX quote)
 *
 * The native asset is priced through its alias, else its WRAPPED form -- and
 * only after confirming on chain that the wrapped token really is the wrapped
 * native (see nativeWrappedToken for why that check is not optional).
 *
 * `opts.at` prices as of a past moment (accounting): DefiLlama's historical
 * endpoint for 1 and 2; GeckoTerminal only if `at` is within the last hour.
 *
 * Unpriced assets say why: no-market (sources answered, nobody quotes it),
 * source-error (a source could not be asked), no-source (no source covers the
 * chain).
 */
export async function priceAssets(
  provider: JsonRpcProvider,
  cfg: NetworkConfig,
  assets: FeeAsset[],
  opts: {
    /** Unix seconds; price as of a past moment instead of now. */
    at?: number;
    /** Curated list for aliases; loaded from data/fee-tokens.json when omitted. */
    feeTokens?: FeeTokensFile | null;
    fetchGecko?: typeof fetchGeckoPrices;
  } = {},
): Promise<{ priced: PricedFeeAsset[]; nativeUsd: number | null; warnings: string[] }> {
  const warnings: string[] = [];
  const priced: PricedFeeAsset[] = assets.map((a) => ({ ...a }));
  if (priced.length === 0) return { priced, nativeUsd: null, warnings };

  let ft: FeeTokensFile | undefined;
  if (opts.feeTokens !== null) {
    try {
      ft = opts.feeTokens ?? loadFeeTokens();
    } catch {
      ft = undefined; // no curated list: aliases simply do not apply
    }
  }
  const aliases = priceAliasesFor(ft, cfg.chainId);

  // Key each asset by what we will look up: its own address, or for native,
  // the verified wrapped token.
  const hasNative = priced.some((a) => a.token === NATIVE_SENTINEL);
  let wrapped: string | undefined;
  if (hasNative && !aliases.native) {
    wrapped = nativeWrappedToken(cfg);
    if (wrapped && !(await symbolMatchesNative(provider, wrapped, cfg.nativeSymbol))) {
      warnings.push(
        `${cfg.networkName}: ${wrapped} does not report a symbol matching ` +
          `${cfg.nativeSymbol}, so it is not treated as the wrapped native asset.`,
      );
      wrapped = undefined;
    }
    if (!wrapped) {
      warnings.push(
        `${cfg.networkName}: no verified wrapped native and no nativePriceAs alias; ` +
          `the native balance cannot be priced.`,
      );
    }
  }
  const lookupOf = (a: PricedFeeAsset): string | undefined =>
    a.token === NATIVE_SENTINEL ? wrapped : toChecksum(a.token) ?? a.token;
  const aliasOf = (a: PricedFeeAsset): string | undefined =>
    a.token === NATIVE_SENTINEL ? aliases.native : aliases.tokens.get(toChecksum(a.token) ?? a.token);

  const firm = new Map<PricedFeeAsset, Quote>();
  const thin = new Map<PricedFeeAsset, Quote>();
  const errored = new Set<PricedFeeAsset>();
  const noMarket = new Set<PricedFeeAsset>();

  // ---- 1. aliases ----
  const aliasKeys = new Set(priced.map(aliasOf).filter((k): k is string => !!k));
  if (aliasKeys.size) {
    const r = await fetchLlamaByKeys(aliasKeys, { at: opts.at });
    warnings.push(...r.warnings);
    for (const a of priced) {
      const k = aliasOf(a);
      const q = k ? r.prices.get(k) : undefined;
      if (q) firm.set(a, { price: q.price, tier: "firm", source: `alias:${k}${q.historical ? `@${q.timestamp}` : ""}` });
    }
  }

  // ---- 2. DefiLlama by address ----
  const needLlama = priced.filter((a) => !firm.has(a) && lookupOf(a));
  const slug = llamaSlug(cfg.networkName);
  if (needLlama.length && slug) {
    const res = await fetchLlamaPrices(cfg.networkName, needLlama.map((a) => lookupOf(a)!), {
      at: opts.at,
      minConfidence: THIN_MIN_CONFIDENCE,
    });
    warnings.push(...res.warnings.filter((w) => !/rejected as low-confidence/.test(w)));
    if (res.warnings.some((w) => /request failed/.test(w))) for (const a of needLlama) errored.add(a);
    for (const a of needLlama) {
      const q = res.prices.get(lookupOf(a)!);
      if (!q) continue;
      const source = q.historical ? `llama-historical@${q.timestamp}` : `llama:${q.confidence.toFixed(2)}`;
      if (q.confidence >= MIN_CONFIDENCE) {
        firm.set(a, { price: q.price, tier: "firm", source });
        errored.delete(a);
      } else {
        thin.set(a, { price: q.price, tier: "thin", source });
      }
    }
  }

  // ---- 3. GeckoTerminal ----
  const nowSec = Math.floor(Date.now() / 1000);
  const geckoOk = opts.at === undefined || nowSec - opts.at <= GECKO_CURRENT_FOR_PAST_SEC;
  const needGecko = priced.filter((a) => !firm.has(a) && lookupOf(a));
  if (needGecko.length && geckoOk) {
    const g = await (opts.fetchGecko ?? fetchGeckoPrices)(cfg.networkName, needGecko.map((a) => lookupOf(a)!));
    warnings.push(...g.warnings);
    for (const a of needGecko) {
      const key = toChecksum(lookupOf(a)!)!;
      const q = g.prices.get(key);
      if (q) {
        errored.delete(a);
        const src = `gecko${opts.at !== undefined ? "-current" : ""}:${fmtLiq(q.reserveUsd)}`;
        if (q.reserveUsd >= FIRM_MIN_LIQUIDITY_USD) {
          firm.set(a, { price: q.price, tier: "firm", source: src, liquidityUsd: q.reserveUsd });
          thin.delete(a);
        } else if (!thin.has(a)) {
          thin.set(a, { price: q.price, tier: "thin", source: src, liquidityUsd: q.reserveUsd });
        }
      } else if (g.failed.has(key)) {
        errored.add(a);
      } else if (g.noMarket.has(key)) {
        noMarket.add(a);
      }
    }
  } else if (needGecko.length && !geckoOk) {
    warnings.push(
      `${cfg.networkName}: ${needGecko.length} asset(s) without a historical DefiLlama price; ` +
        `GeckoTerminal has no historical prices, so they stay unpriced in this record`,
    );
  }

  // ---- assign ----
  let nativeUsd: number | null = null;
  let thinCount = 0;
  let unpricedCount = 0;
  for (const a of priced) {
    const q = firm.get(a) ?? thin.get(a);
    if (!q) {
      a.priceSource = !lookupOf(a)
        ? "unpriced:no-source"
        : errored.has(a)
          ? "unpriced:source-error"
          : noMarket.has(a)
            ? "unpriced:no-market"
            : "unpriced:no-source";
      unpricedCount++;
      continue;
    }
    const value = Number(formatUnits(a.balance, a.decimals)) * q.price;
    a.usdPrice = q.price;
    a.priceTier = q.tier;
    a.priceSource = q.source;
    if (q.liquidityUsd !== undefined) a.liquidityUsd = q.liquidityUsd;
    if (q.tier === "firm") a.usdValue = value;
    else {
      a.usdValueThin = value;
      thinCount++;
    }
    if (a.token === NATIVE_SENTINEL) nativeUsd = q.price;
  }

  if (thinCount || unpricedCount) {
    warnings.push(
      `${cfg.networkName}: ${thinCount} thin price(s) shown but not counted, ` +
        `${unpricedCount} asset(s) unpriced`,
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
  priced.sort(
    (a, b) =>
      (b.usdValue ?? -1) - (a.usdValue ?? -1) || (b.usdValueThin ?? -1) - (a.usdValueThin ?? -1),
  );

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
export function totalUsd(
  assets: Pick<PricedFeeAsset, "usdValue" | "usdValueThin">[],
): { notional: number; unpriced: number; thinUsd: number; thinCount: number } {
  let notional = 0;
  let unpriced = 0;
  let thinUsd = 0;
  let thinCount = 0;
  for (const a of assets) {
    if (a.usdValue !== undefined) notional += a.usdValue;
    else if (a.usdValueThin !== undefined) {
      thinUsd += a.usdValueThin;
      thinCount++;
    } else unpriced++;
  }
  return { notional, unpriced, thinUsd, thinCount };
}

/** Human-readable amount, for tables and the accounting markdown. */
export function fmtAmount(a: { balance: bigint; decimals: number }): string {
  return formatUnits(a.balance, a.decimals);
}
