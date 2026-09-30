/**
 * feeScan.ts
 *
 * Discovery and valuation of idle protocol fees sitting on an OkuRouter.
 *
 * The router has NO fee accounting. Fees are not tracked in any state
 * variable or mapping -- they simply accumulate as the contract's own token
 * and ETH balance:
 *   - token -> token : fee is withheld from the input token (the router pulls
 *                      `sellAmount` but only approves `sellAmount - feeAmount`)
 *   - ETH   -> token : fee is withheld from msg.value
 *   - token -> ETH   : fee is taken in basis points out of the output ETH
 *
 * Consequently there is no view function to ask "what is collectable". The
 * only way to know is to (a) work out which assets have ever flowed through,
 * and (b) read `balanceOf(router)` for each. This module does both.
 *
 * Asset discovery is driven by the `OrderFilled` event, whose `tokenIn` is the
 * fee asset for every case except token -> ETH (where the fee is native). The
 * event's token fields are NOT indexed, so they cannot be filtered by topic --
 * logs must be fetched and decoded.
 *
 * Valuation is done from Uniswap V3 pools on the same chain rather than an
 * external price API, so it needs no key and cannot disagree with the chain.
 * Crucially it reports pool DEPTH alongside spot price: most of these assets
 * are long-tail tokens that happened to route through the router once, and a
 * spot price against an empty pool is a fiction. Callers should present the
 * depth-capped figure, not the notional.
 */
import type { JsonRpcProvider, Log } from "ethers";
import { Interface, getAddress, formatUnits } from "ethers";
import { OkuRouter__factory } from "../typechain-types";
import type { NetworkConfig } from "./deploymentConfig";
import { logsEnvVar } from "./safeChains";
import { toChecksum } from "./address";
import { fetchLlamaPrices, llamaSlug } from "./priceLlama";

/** Pseudo-address used to represent the chain's native asset in asset lists. */
export const NATIVE_SENTINEL = "native";

const ERC20_IFACE = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const FACTORY_IFACE = new Interface([
  "function getPool(address,address,uint24) view returns (address)",
]);

const POOL_IFACE = new Interface([
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
  "function token0() view returns (address)",
]);

/** Uniswap V3 fee tiers, in the order we prefer to probe them. */
const FEE_TIERS = [500, 3000, 100, 10000] as const;

/**
 * getLogs range caps vary enormously between providers, and none of them
 * advertise the limit -- you discover it by being rejected. Probed
 * high-to-low; the first span that returns is used for the whole scan.
 */
const RANGE_PROBES = [
  10_000_000, 1_000_000, 100_000, 10_000, 2_000, 1_000, 500, 200, 100, 50, 20, 10,
];

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export interface FeeAsset {
  /** Checksummed ERC20 address, or NATIVE_SENTINEL. */
  token: string;
  symbol: string;
  decimals: number;
  balance: bigint;
}

export interface PriceInfo {
  /** USD per whole token. */
  usdPrice: number;
  /** Quote-token liquidity in the pool used, expressed in USD. */
  poolDepthUsd: number;
  /** e.g. "univ3:0xabc…@500" or "stable:usdc". */
  source: string;
}

export interface PricedFeeAsset extends FeeAsset {
  usdPrice?: number;
  usdValue?: number;
  poolDepthUsd?: number;
  /**
   * usdValue capped at a conservative fraction of pool depth. A long-tail
   * token can show a large notional against a pool with nothing in it; this
   * is the number to make decisions on.
   */
  realizableUsd?: number;
  priceSource?: string;
}

export interface ScanCoverage {
  fromBlock: number;
  toBlock: number;
  /** Log span the RPC accepted per request. */
  rangeUsed: number;
  /** True when history was truncated to respect the request budget. */
  partial: boolean;
  /** OrderFilled events decoded. */
  events: number;
  /** Distinct fee assets ever observed (before balance filtering). */
  everSeen: number;
  /**
   * Windows the RPC refused mid-scan. A single refused window does not abort
   * the scan, but it does leave a hole, so this must be surfaced: a caller
   * that persists a resume point would otherwise skip those blocks forever.
   */
  refusedWindows: number;
  /**
   * Highest block at or below which EVERY window was scanned successfully --
   * the only value an incremental scan may safely resume from.
   *
   * Null when the very first window was refused, meaning nothing contiguous
   * was established and there is no safe resume point.
   */
  scannedThrough: number | null;
}

/**
 * How much of a chain's fee history discovery actually managed to see.
 *
 *   complete   — the full history behind the router was walked.
 *   partial    — a meaningful fraction was walked; assets first traded
 *                outside the window are invisible but the window is wide
 *                enough to be worth something.
 *   unreliable — effectively nothing was discovered. The asset list is the
 *                hardcoded well-known set plus whatever a previous run
 *                cached, and treating the result as "this chain's fees" is
 *                wrong.
 *
 * This distinction exists because it was got wrong in production. On the
 * 2026-09-29 sweep, avax scanned 4,000 blocks of a ~96,000,000 block history
 * (0.004%), discovered one token, and was reported as "$0.00" -- while the
 * router held nine tokens including USDC 1,173. The scan DID emit a warning,
 * but it was one string in a `warnings[]` array among 34 chains and was read
 * straight past. A verdict callers must branch on is much harder to ignore
 * than a warning they can forget to print.
 */
export type DiscoveryQuality = "complete" | "partial" | "unreliable";

/**
 * Fraction of history below which discovery is considered unreliable rather
 * than merely partial.
 *
 * 1% is deliberately generous: the failure this guards against looked like
 * 0.004%, not 0.9%. The goal is to catch "the endpoint refused to tell us
 * anything useful", not to demand completeness.
 */
export const UNRELIABLE_COVERAGE_FRACTION = 0.01;

/** Fraction of history covered, 0..1, for reporting alongside the verdict. */
export function coverageFraction(
  coverage: ScanCoverage | null,
  historySpan: number,
): number {
  if (!coverage || historySpan <= 0) return 0;
  const scanned = Math.max(0, coverage.toBlock - coverage.fromBlock + 1);
  return Math.min(1, scanned / historySpan);
}

/**
 * Judge how much of a chain's history discovery covered.
 *
 * `historySpan` is the number of blocks of history the scan could in
 * principle have walked. Callers that cannot determine the router's first
 * block should pass the chain head, which over-estimates history and
 * therefore errs toward reporting a WORSE verdict -- the safe direction.
 */
export function discoveryQuality(
  coverage: ScanCoverage | null,
  historySpan: number,
): DiscoveryQuality {
  // No coverage at all means the endpoint refused eth_getLogs outright.
  if (!coverage) return "unreliable";
  if (!coverage.partial && coverage.refusedWindows === 0) return "complete";
  if (historySpan <= 0) return coverage.partial ? "partial" : "complete";
  // A scan that saw almost nothing is not "partial", it is uninformative.
  if (coverageFraction(coverage, historySpan) < UNRELIABLE_COVERAGE_FRACTION) {
    return "unreliable";
  }
  return "partial";
}

export interface FeeScanResult {
  router: string;
  assets: PricedFeeAsset[];
  coverage: ScanCoverage | null;
  /** Non-fatal problems worth surfacing (RPC refused logs, pricing gaps, …). */
  warnings: string[];
}

/**
 * Re-exported from util/address.ts, which is where the implementation and its
 * EIP-1191 rationale now live. Kept exported here so the many existing
 * importers do not have to move.
 */
export { toChecksum };

/**
 * The provider surface log discovery actually uses.
 *
 * Structural rather than the concrete JsonRpcProvider so the incremental
 * scan logic -- where the resume-point rules live, and where a bug silently
 * loses assets -- can be unit tested against a scripted fake instead of
 * needing a live chain.
 */
export type LogScanProvider = Pick<JsonRpcProvider, "getBlockNumber" | "getLogs">;

/** Fraction of pool depth we treat as realistically exitable. */
const REALIZABLE_DEPTH_FRACTION = 0.3;

/**
 * Quote-side liquidity, in USD, below which a pool is not treated as evidence
 * of a price at all. Deliberately tiny: the target is degenerate pools holding
 * fractions of a cent, not merely thin ones -- thin pools are already handled
 * honestly by the realizable cap.
 */
const MIN_POOL_DEPTH_USD = 1;

/**
 * Ratio of notional-to-pool-depth above which a quote is treated as an
 * artifact rather than a price. See the use site for the reasoning and for
 * the base `UP` token that motivated it.
 */
const MAX_NOTIONAL_TO_DEPTH_RATIO = 1e6;

/**
 * Find the largest block span this endpoint will accept for eth_getLogs.
 * Returns 0 if the endpoint refuses even the smallest probe.
 */
export async function probeLogRange(
  provider: LogScanProvider,
  address: string,
  latest: number,
): Promise<number> {
  for (const span of RANGE_PROBES) {
    try {
      // Inclusive bounds: fromBlock..toBlock spans `span` blocks, not span+1.
      // Providers that advertise a "100 block range" reject 101, so being off
      // by one here silently downgrades the scan to nothing.
      await provider.getLogs({
        address,
        fromBlock: Math.max(0, latest - span + 1),
        toBlock: latest,
      });
      return span;
    } catch {
      // Refused: try a smaller window.
    }
  }
  return 0;
}

/**
 * Scan `OrderFilled` logs for every asset that has ever been taken as a fee.
 *
 * `maxRequests` bounds the work: on a chain with a 200-block log cap and
 * millions of blocks, a full-history scan is not viable. When the budget is
 * insufficient the scan walks BACKWARD from head and reports `partial: true`
 * so callers can say so out loud rather than implying completeness. Known
 * tokens are unioned in separately, which keeps the common assets covered
 * even on a partial scan.
 */
export async function scanFeeAssets(
  provider: LogScanProvider,
  router: string,
  opts: { maxRequests?: number; fromBlock?: number } = {},
): Promise<{ tokens: Set<string>; coverage: ScanCoverage | null }> {
  const maxRequests = opts.maxRequests ?? 400;
  const latest = await provider.getBlockNumber();
  const range = await probeLogRange(provider, router, latest);
  if (range === 0) return { tokens: new Set(), coverage: null };

  let from = opts.fromBlock ?? 0;
  let partial = false;
  const needed = Math.ceil((latest - from + 1) / range);
  if (needed > maxRequests) {
    from = Math.max(0, latest - maxRequests * range + 1);
    partial = true;
  }

  const win = await scanLogWindow(provider, router, from, latest, range);

  return {
    tokens: win.tokens,
    coverage: {
      fromBlock: from,
      toBlock: latest,
      rangeUsed: range,
      partial,
      events: win.events,
      everSeen: win.tokens.size,
      refusedWindows: win.refusedWindows,
      scannedThrough: win.scannedThrough,
    },
  };
}

/** Outcome of walking one contiguous block window for OrderFilled logs. */
export interface LogWindowResult {
  /** Fee assets (OrderFilled.tokenIn) observed in this window. */
  tokens: Set<string>;
  /** OrderFilled events decoded. */
  events: number;
  /** Windows the RPC refused. Non-zero means the coverage has holes. */
  refusedWindows: number;
  /**
   * Highest block reached with NO preceding refusal, i.e. the safe resume
   * point. `fromBlock - 1` if the first window was refused; null if that
   * would be negative (nothing contiguous was established at all).
   */
  scannedThrough: number | null;
}

/**
 * Walk `fromBlock..toBlock` inclusive in `range`-sized windows, collecting
 * fee assets from OrderFilled.
 *
 * A refused window is skipped rather than aborting the scan -- some endpoints
 * fail intermittently and giving up would discard everything already found.
 * But the resume point then STOPS ADVANCING. This is the whole reason the
 * function reports `scannedThrough` separately from `toBlock`: persisting
 * `toBlock` as a resume point after a mid-scan refusal would skip the
 * unscanned blocks permanently, and any asset first traded inside that hole
 * would become invisible to every future run. The hole is re-scanned instead.
 */
export async function scanLogWindow(
  provider: LogScanProvider,
  router: string,
  fromBlock: number,
  toBlock: number,
  range: number,
): Promise<LogWindowResult> {
  const topic = OkuRouter__factory.createInterface().getEvent("OrderFilled").topicHash;
  const tokens = new Set<string>();
  let events = 0;
  let refusedWindows = 0;
  let holed = false;
  let scannedThrough: number | null = fromBlock > 0 ? fromBlock - 1 : null;

  for (let start = fromBlock; start <= toBlock; start += range) {
    const end = Math.min(start + range - 1, toBlock);
    let logs: Log[];
    try {
      logs = await provider.getLogs({
        address: router,
        fromBlock: start,
        toBlock: end,
        topics: [topic],
      });
    } catch {
      refusedWindows++;
      holed = true;
      continue;
    }
    if (!holed) scannedThrough = end;
    for (const log of logs) {
      events++;
      // tokenIn is the first non-indexed field. A zero tokenIn means the swap
      // was ETH -> token, where the fee is native and there is no ERC20 to add.
      const tokenIn = `0x${log.data.slice(26, 66)}`;
      if (tokenIn !== ZERO_ADDR) tokens.add(getAddress(tokenIn));
    }
  }

  return { tokens, events, refusedWindows, scannedThrough };
}

/** Read symbol/decimals/balance for a set of candidate tokens, keeping non-zero ones. */
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
 * Spot price of `token` denominated in `quote`, from the deepest V3 pool.
 *
 * Returns the price as a float alongside the quote-side balance of the pool,
 * which is the honest measure of whether that price is obtainable.
 */
async function poolPrice(
  provider: JsonRpcProvider,
  factory: string,
  token: string,
  tokenDecimals: number,
  quote: string,
  quoteDecimals: number,
): Promise<{ price: number; quoteBalance: bigint; pool: string; fee: number } | null> {
  let best: { price: number; quoteBalance: bigint; pool: string; fee: number } | null = null;
  for (const fee of FEE_TIERS) {
    try {
      const res = await provider.call({
        to: factory,
        data: FACTORY_IFACE.encodeFunctionData("getPool", [token, quote, fee]),
      });
      const pool = getAddress(`0x${res.slice(26)}`);
      if (pool === ZERO_ADDR) continue;

      const slot0 = await provider.call({
        to: pool,
        data: POOL_IFACE.encodeFunctionData("slot0", []),
      });
      const sqrtPriceX96 = BigInt(POOL_IFACE.decodeFunctionResult("slot0", slot0)[0]);
      if (sqrtPriceX96 === 0n) continue;

      const t0Raw = await provider.call({
        to: pool,
        data: POOL_IFACE.encodeFunctionData("token0", []),
      });
      const token0 = getAddress(POOL_IFACE.decodeFunctionResult("token0", t0Raw)[0] as string);

      const quoteBalRaw = await provider.call({
        to: quote,
        data: ERC20_IFACE.encodeFunctionData("balanceOf", [pool]),
      });
      const quoteBalance = BigInt(quoteBalRaw);

      // price of token1 per token0, in raw units, carried through BigInt so a
      // small ratio does not truncate to zero before it reaches a float.
      const scaled = (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / 2n ** 192n;
      const raw = Number(scaled) / 1e18;
      if (!Number.isFinite(raw) || raw === 0) continue;

      const price =
        token0 === getAddress(token)
          ? raw * 10 ** (tokenDecimals - quoteDecimals)
          : (1 / raw) * 10 ** (tokenDecimals - quoteDecimals);
      if (!Number.isFinite(price) || price <= 0) continue;

      if (!best || quoteBalance > best.quoteBalance) best = { price, quoteBalance, pool, fee };
    } catch {
      // Missing or unreadable pool at this tier.
    }
  }
  return best;
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
 * Relative gap between the on-chain and off-chain price above which we say so.
 *
 * Not an error: a thin V3 pool and a deep CEX book legitimately disagree. But
 * a large divergence is the signature of the failure this module has already
 * had twice (a dust pool quoting a fabricated number), so it is worth a line
 * in the report rather than silent acceptance.
 */
const PRICE_DIVERGENCE_WARN = 0.25;

/**
 * Attach USD valuations to a set of assets using on-chain V3 pools.
 *
 * Tries token/USDC first and token/WETH second, preferring whichever pool
 * holds more quote-side liquidity. Assets with no pool are left unpriced
 * rather than assigned a zero, so "unknown" is distinguishable from
 * "worthless".
 *
 * `opts.llama` adds DefiLlama as a FALLBACK for assets no pool could price,
 * and as a cross-check on the ones that were. It is off by default, because
 * the two historical callers (`fees:account`, the fork rehearsal) value
 * assets at a PAST block, and a current off-chain price there would be
 * quietly wrong. The live scan path opts in.
 */
export async function priceAssets(
  provider: JsonRpcProvider,
  cfg: NetworkConfig,
  assets: FeeAsset[],
  opts: { llama?: boolean } = {},
): Promise<{ priced: PricedFeeAsset[]; nativeUsd: number | null; warnings: string[] }> {
  const warnings: string[] = [];
  const uni = (cfg.chain as unknown as { uniswap?: { poolFactory?: string } }).uniswap;
  const factory = uni?.poolFactory;
  const usdc = cfg.usdcAddress;
  const weth = cfg.wethAddress;

  // A chain with no V3 deployment cannot be valued on-chain AT ALL, which
  // makes it the case that needs the off-chain fallback most -- so these two
  // early exits must still run it. Returning straight out of here is what
  // made celo report "$0.00" while holding three assets DefiLlama prices
  // perfectly well.
  const bailOut = async (why: string) => {
    warnings.push(why);
    const priced: PricedFeeAsset[] = assets.map((a) => ({ ...a }));
    if (opts.llama) warnings.push(...(await applyLlamaPrices(cfg, priced)));
    return { priced, nativeUsd: null, warnings };
  };

  if (!factory || !usdc || !weth) {
    return await bailOut(`no V3 factory/USDC/WETH for ${cfg.networkName}; on-chain valuation unavailable`);
  }

  const usdcAddr = toChecksum(usdc);
  const wethAddr = toChecksum(weth);
  if (!usdcAddr || !wethAddr) {
    return await bailOut(
      `${cfg.networkName}: malformed USDC/WETH address in chain config; on-chain valuation unavailable`,
    );
  }

  // USDC decimals, read once; it anchors every other price.
  let usdcDecimals = 6;
  try {
    const d = await provider.call({ to: usdcAddr, data: ERC20_IFACE.encodeFunctionData("decimals", []) });
    usdcDecimals = Number(BigInt(d));
  } catch {
    warnings.push("could not read USDC decimals; assuming 6");
  }

  const ethPoolRaw = await poolPrice(provider, factory, wethAddr, 18, usdcAddr, usdcDecimals);
  // The anchor pool. Every WETH-quoted price is multiplied by this one, so a
  // dust-liquidity anchor would propagate a fabricated number across the
  // whole chain rather than to a single asset.
  const ethPool =
    ethPoolRaw && Number(formatUnits(ethPoolRaw.quoteBalance, usdcDecimals)) >= MIN_POOL_DEPTH_USD
      ? ethPoolRaw
      : null;
  const wethUsd = ethPool ? ethPool.price : null;
  if (!wethUsd) {
    warnings.push(
      `${cfg.networkName}: no WETH/USDC pool with usable liquidity; native and ` +
        `WETH-quoted assets are unpriced`,
    );
  }

  // Is cfg.wethAddress actually the WRAPPED FORM OF THIS CHAIN'S NATIVE ASSET?
  //
  // Usually yes -- it is WAVAX on Avalanche, WXDAI on Gnosis, WBNB on BSC,
  // WRBTC on Rootstock. But on Polygon it is bridged WETH while the native
  // asset is POL, and assuming otherwise priced 9.6 POL at $26,447 by giving
  // it the price of ether: a 10,000x overstatement, and enough on its own to
  // make a whole-estate total meaningless.
  //
  // Checked by reading the symbol rather than keeping a per-chain table,
  // because a table is exactly the thing that silently goes stale. If it
  // cannot be established, native is left UNPRICED: this module's rule is
  // that unknown must stay distinguishable from worthless, and a wrong price
  // is far worse than no price.
  const wethIsWrappedNative = await symbolMatchesNative(provider, wethAddr, cfg.nativeSymbol);
  const nativeUsd = wethIsWrappedNative ? wethUsd : null;
  if (!wethIsWrappedNative && assets.some((a) => a.token === NATIVE_SENTINEL)) {
    warnings.push(
      `${cfg.networkName}: the configured WETH is not the wrapped form of ${cfg.nativeSymbol}, ` +
        `so the native balance is left unpriced rather than valued as ether.`,
    );
  }

  const priced: PricedFeeAsset[] = [];
  for (const a of assets) {
    const amount = Number(formatUnits(a.balance, a.decimals));

    if (a.token === NATIVE_SENTINEL) {
      if (nativeUsd !== null) {
        priced.push({
          ...a,
          usdPrice: nativeUsd,
          usdValue: amount * nativeUsd,
          poolDepthUsd: ethPool ? Number(formatUnits(ethPool.quoteBalance, usdcDecimals)) : undefined,
          realizableUsd: amount * nativeUsd,
          priceSource: ethPool ? `univ3:${ethPool.pool}@${ethPool.fee}` : "unpriced",
        });
      } else {
        priced.push({ ...a });
      }
      continue;
    }

    if (toChecksum(a.token) === wethAddr) {
      // The WETH token itself is priced off its own pool regardless of what
      // the native asset is -- that part was never ambiguous.
      if (wethUsd !== null) {
        priced.push({
          ...a,
          usdPrice: wethUsd,
          usdValue: amount * wethUsd,
          poolDepthUsd: ethPool ? Number(formatUnits(ethPool.quoteBalance, usdcDecimals)) : undefined,
          realizableUsd: amount * wethUsd,
          priceSource: ethPool ? `univ3:${ethPool.pool}@${ethPool.fee}` : "unpriced",
        });
      } else {
        priced.push({ ...a });
      }
      continue;
    }

    if (toChecksum(a.token) === usdcAddr) {
      priced.push({
        ...a,
        usdPrice: 1,
        usdValue: amount,
        realizableUsd: amount,
        priceSource: "stable:usdc",
      });
      continue;
    }

    const viaUsdc = await poolPrice(provider, factory, a.token, a.decimals, usdcAddr, usdcDecimals);
    const viaWeth = nativeUsd !== null
      ? await poolPrice(provider, factory, a.token, a.decimals, wethAddr, 18)
      : null;

    const cands: { usd: number; depth: number; src: string }[] = [];
    if (viaUsdc) {
      cands.push({
        usd: amount * viaUsdc.price,
        depth: Number(formatUnits(viaUsdc.quoteBalance, usdcDecimals)),
        src: `univ3:${viaUsdc.pool}@${viaUsdc.fee}`,
      });
    }
    if (viaWeth && nativeUsd !== null) {
      cands.push({
        usd: amount * viaWeth.price * nativeUsd,
        depth: Number(formatUnits(viaWeth.quoteBalance, 18)) * nativeUsd,
        src: `univ3:${viaWeth.pool}@${viaWeth.fee}`,
      });
    }
    // Deepest pool wins: it is the one whose price is actually obtainable.
    cands.sort((x, y) => y.depth - x.depth);
    const pick = cands[0];
    if (!pick) {
      priced.push({ ...a });
      continue;
    }
    // A pool holding essentially nothing does not establish a price; its
    // sqrtPriceX96 is whatever the last trade left behind, and dividing by a
    // dust reserve produces numbers with no meaning. One mainnet token quoted
    // $9.4e41 against a pool holding $2.7e-9, which alone made the estate
    // total read as 4.4e41 dollars.
    //
    // Reporting no price is the honest outcome. The module's rule that
    // "unknown" must stay distinguishable from "worthless" cuts both ways: a
    // fabricated price is worse than an absent one, because only the absent
    // one prompts someone to go and look.
    if (pick.depth < MIN_POOL_DEPTH_USD) {
      priced.push({ ...a, poolDepthUsd: pick.depth, priceSource: "unpriced:no-liquidity" });
      continue;
    }
    // The pool is the ONLY evidence for this price, so a valuation that
    // exceeds the pool's entire depth by an absurd factor is not a price --
    // it is an artifact of dividing by a near-empty reserve. The depth floor
    // above catches pools holding nothing; this catches pools holding
    // *almost* nothing, which the floor lets through.
    //
    // Observed: base token `UP` quoted $3.4e50 per token against a pool
    // holding $1.25, producing a $2.1e50 line item that made the whole scan's
    // notional total read as 2.1e50 dollars. Realizable was unaffected (it is
    // capped at a fraction of depth), which is exactly why this slipped by --
    // only the notional column was nonsense.
    //
    // 1e6 is deliberately loose: a router legitimately holding a million
    // times a dead token's pool depth is already a curiosity, and realizable
    // still reports it honestly. The target is 1e50, not 1e3.
    if (pick.usd > pick.depth * MAX_NOTIONAL_TO_DEPTH_RATIO) {
      warnings.push(
        `${a.symbol} (${a.token}): quote of ${pick.usd.toExponential(2)} USD against a pool ` +
          `holding only ${pick.depth.toFixed(2)} USD is not credible; reporting unpriced`,
      );
      priced.push({
        ...a,
        poolDepthUsd: pick.depth,
        // Realizable is still meaningful: it is bounded by pool depth, which
        // is a real measurement even when the price derived from it is not.
        realizableUsd: pick.depth * REALIZABLE_DEPTH_FRACTION,
        priceSource: "unpriced:implausible-quote",
      });
      continue;
    }
    priced.push({
      ...a,
      usdPrice: pick.usd / (amount || 1),
      usdValue: pick.usd,
      poolDepthUsd: pick.depth,
      realizableUsd: Math.min(pick.usd, pick.depth * REALIZABLE_DEPTH_FRACTION),
      priceSource: pick.src,
    });
  }

  if (opts.llama) {
    warnings.push(...(await applyLlamaPrices(cfg, priced)));
  }

  return { priced, nativeUsd, warnings };
}

/**
 * Fill pricing gaps from DefiLlama, and cross-check the ones V3 did price.
 *
 * Two rules make this safe to add to a path that decides what gets swept:
 *
 *   1. It NEVER overwrites an on-chain price. V3 is the better source where
 *      it works, and it is the one that pairs with a real depth measurement.
 *      DefiLlama only fills `usdValue` where there was none.
 *
 *   2. It NEVER sets `realizableUsd`. Depth is a purely on-chain measurement.
 *      An off-chain price tells you what a token is worth somewhere, not
 *      whether this chain has the liquidity to exit into -- and `--min-usd`
 *      gates on realizable. Letting a Llama price raise it would mean sweeping
 *      decisions made on liquidity that was never observed to exist.
 *
 * Mutates `priced` in place and returns warnings.
 */
async function applyLlamaPrices(
  cfg: NetworkConfig,
  priced: PricedFeeAsset[],
): Promise<string[]> {
  const warnings: string[] = [];
  if (!llamaSlug(cfg.networkName)) return warnings;

  const erc20 = priced.filter((a) => a.token !== NATIVE_SENTINEL);
  if (erc20.length === 0) return warnings;

  const res = await fetchLlamaPrices(
    cfg.networkName,
    erc20.map((a) => a.token),
  );
  warnings.push(...res.warnings);
  if (res.prices.size === 0) return warnings;

  let filled = 0;
  for (const a of erc20) {
    const key = toChecksum(a.token);
    const quote = key ? res.prices.get(key) : undefined;
    if (!quote) continue;
    const amount = Number(formatUnits(a.balance, a.decimals));

    if (a.usdPrice === undefined) {
      a.usdPrice = quote.price;
      a.usdValue = amount * quote.price;
      // realizableUsd deliberately left alone -- see rule 2 above. Where the
      // implausible-quote branch already set one from measured pool depth,
      // that measurement stands.
      a.priceSource = `llama:${quote.confidence.toFixed(2)}`;
      filled++;
      continue;
    }

    // Both sources have an opinion: compare them.
    const onChain = a.usdPrice;
    if (onChain > 0) {
      const gap = Math.abs(onChain - quote.price) / onChain;
      if (gap > PRICE_DIVERGENCE_WARN) {
        warnings.push(
          `${a.symbol} (${a.token}): on-chain pool price $${onChain.toPrecision(6)} vs ` +
            `DefiLlama $${quote.price.toPrecision(6)} (${(gap * 100).toFixed(0)}% apart); ` +
            `reporting the on-chain figure`,
        );
      }
    }
  }

  if (filled > 0) {
    warnings.push(
      `${cfg.networkName}: ${filled} asset(s) priced from DefiLlama because no V3 pool ` +
        `could value them. These have a notional but NO realizable figure, since pool ` +
        `depth was never observed.`,
    );
  }
  return warnings;
}

/**
 * Full idle-fee picture for one chain: discover assets, read balances, price.
 *
 * `includeNative` adds the router's ETH balance as a synthetic asset so the
 * caller can present one list; `sweepAll` takes native via its `includeEth`
 * flag rather than an array entry, so callers must NOT pass the sentinel into
 * the tokens array.
 */
export async function scanChainFees(
  provider: JsonRpcProvider,
  cfg: NetworkConfig,
  router: string,
  opts: {
    maxRequests?: number;
    price?: boolean;
    /**
     * Use DefiLlama to fill pricing gaps. Default true: this is the live
     * "what is sitting there right now" path, where a current off-chain price
     * is exactly the right thing to fall back on.
     */
    llama?: boolean;
    /**
     * Pre-computed discovery, so a caller that already knows which assets have
     * ever flowed through (from the incremental cache, or from an earlier
     * snapshot) does not pay for log discovery a second time. Balances are
     * ALWAYS re-read live regardless, so injecting a stale token set can only
     * omit a newly-traded asset -- it can never produce a wrong amount.
     */
    discovery?: { tokens: Iterable<string>; coverage: ScanCoverage | null };
  } = {},
): Promise<FeeScanResult> {
  const warnings: string[] = [];

  const discovered =
    opts.discovery ??
    (await scanFeeAssets(provider, router, { maxRequests: opts.maxRequests }));
  const tokens = new Set<string>(discovered.tokens);
  const coverage = discovered.coverage;
  if (!coverage) {
    warnings.push(
      `${cfg.networkName}: RPC refused eth_getLogs at every probed range, so long-tail ` +
        `assets CANNOT be discovered -- only well-known tokens are covered. Re-run with ` +
        `--rpc <endpoint that supports eth_getLogs> for a complete picture.`,
    );
  } else if (coverage.partial) {
    const blocks = coverage.toBlock - coverage.fromBlock + 1;
    warnings.push(
      `${cfg.networkName}: INCOMPLETE. This endpoint caps eth_getLogs at ${coverage.rangeUsed} ` +
        `block(s), so within the request budget only the last ${blocks} blocks ` +
        `(${coverage.fromBlock}-${coverage.toBlock}) were scanned. Assets last traded before ` +
        `that appear only if well-known. Set ${logsEnvVar(cfg.networkName)} to a wider-range ` +
        `endpoint, or raise --max-requests, for full history.`,
    );
  }
  if (coverage && coverage.refusedWindows > 0) {
    warnings.push(
      `${cfg.networkName}: ${coverage.refusedWindows} log window(s) were refused mid-scan, ` +
        `so discovery has holes. The resume point was held at block ` +
        `${coverage.scannedThrough ?? coverage.fromBlock} so the gap is re-scanned next run ` +
        `rather than skipped forever.`,
    );
  }

  // Union in the chain's well-known tokens. This is what keeps a partial or
  // refused log scan from missing USDC/WETH/WBTC, which is where the value is.
  const known = (cfg.chain as unknown as { token?: Record<string, string> }).token ?? {};
  for (const v of [known.wethAddress, known.wbtcAddress, known.usdcAddress, cfg.wethAddress, cfg.usdcAddress]) {
    const addr = toChecksum(v);
    if (addr) tokens.add(addr);
  }

  const erc20 = await readNonZeroBalances(provider, router, tokens);

  const assets: FeeAsset[] = [...erc20];
  const nativeBal = await provider.getBalance(router);
  if (nativeBal > 0n) {
    assets.push({
      token: NATIVE_SENTINEL,
      symbol: cfg.nativeSymbol,
      decimals: 18,
      balance: nativeBal,
    });
  }

  if (opts.price === false) {
    return { router, assets, coverage, warnings };
  }

  const { priced, warnings: priceWarnings } = await priceAssets(provider, cfg, assets, {
    llama: opts.llama !== false,
  });
  warnings.push(...priceWarnings);

  priced.sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1));
  return { router, assets: priced, coverage, warnings };
}

/**
 * Sum helpers used by both the scan task and the accounting report.
 *
 * `unpriced` is part of the return value rather than something callers may
 * compute if they remember to. Summing with `?? 0` silently turns "we could
 * not value this" into "this is worth nothing", and on the 2026-09-30 scan
 * that made eleven chains report exactly "$0.00" while holding 173 unvalued
 * assets between them -- a total that reads as "nothing here" when it means
 * "we do not know". Anything rendering these figures must be able to say how
 * many assets are behind them.
 */
export function totalUsd(assets: PricedFeeAsset[]): {
  notional: number;
  realizable: number;
  /** Assets with no usdValue at all. Excluded from `notional`. */
  unpriced: number;
  /** Assets with a notional but no depth-backed realizable figure. */
  noDepth: number;
} {
  let notional = 0;
  let realizable = 0;
  let unpriced = 0;
  let noDepth = 0;
  for (const a of assets) {
    if (a.usdValue === undefined) unpriced++;
    else notional += a.usdValue;
    if (a.realizableUsd === undefined) {
      if (a.usdValue !== undefined) noDepth++;
    } else {
      realizable += a.realizableUsd;
    }
  }
  return { notional, realizable, unpriced, noDepth };
}

/** Human-readable amount, for tables and the accounting markdown. */
export function fmtAmount(a: { balance: bigint; decimals: number }): string {
  return formatUnits(a.balance, a.decimals);
}
