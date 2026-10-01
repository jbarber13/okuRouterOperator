/**
 * feeSweepScan.ts
 *
 * One chain's fee scan, packaged as a SnapshotChain.
 *
 * Shared by `fees:scan` and `fees:cycle` so the two cannot drift: the report
 * an operator reads and the data a sweep bundle is built from must come from
 * the same code path, or the bundle will eventually disagree with the report
 * that authorized it.
 *
 * Every failure mode is captured as a status rather than thrown. A 34-chain
 * sweep must not lose 33 chains because one endpoint timed out, but it must
 * also not quietly treat that timeout as "nothing to collect".
 */
import { makeProvider, type SafeChain } from "./safeChains";
import { NETWORK_CONFIGS } from "./deploymentConfig";
import { scanChainFees, totalUsd } from "./feeScan";
import { toSnapshotAsset, type SnapshotChain } from "./feeSnapshot";
import { buildTokenUniverse } from "./tokenUniverse";

export interface ChainScanOptions {
  /**
   * Per-chain candidate token set, indexed by chainId. Built once by the
   * caller and shared, because the published list is ~8 MB and re-parsing it
   * per chain would cost more than the probe it feeds.
   */
  tokenListByChain: Map<number, Set<string>>;
  /** USD valuation. Default true. */
  price?: boolean;
  /** Explicit RPC, overriding the chain's configured one. Single-chain use. */
  rpcOverride?: string;
}

/** Scan one chain and return its snapshot entry. */
export async function scanChainForSnapshot(
  chain: SafeChain,
  opts: ChainScanOptions,
): Promise<SnapshotChain> {
  const base: SnapshotChain = {
    network: chain.network,
    chainId: chain.chainId,
    router: chain.router,
    status: "empty",
    warnings: [],
    assets: [],
    totals: { assetCount: 0, usdNotional: 0, unpricedCount: 0 },
  };

  const rpc = opts.rpcOverride ?? chain.rpcUrl;
  if (!rpc) return { ...base, status: "no-rpc" };
  if (!chain.router) return { ...base, status: "no-rpc", error: "no OkuRouter in deployments/" };

  const cfg = NETWORK_CONFIGS[chain.network];
  if (!cfg) return { ...base, status: "no-config" };

  const universe = buildTokenUniverse(chain, opts.tokenListByChain, cfg);
  const provider = makeProvider(rpc, chain.chainId);
  try {
    const res = await scanChainFees(provider, cfg, chain.router, {
      candidates: universe.tokens,
      price: opts.price !== false,
    });

    const { notional, unpriced } = totalUsd(res.assets);

    return {
      ...base,
      status: res.assets.length > 0 ? "has-fees" : "empty",
      probe: {
        candidates: res.candidates,
        calls: res.calls,
        found: res.assets.length,
        unchecked: res.unchecked,
        sources: universe.sources,
      },
      warnings: [...universe.warnings, ...res.warnings],
      assets: res.assets.map(toSnapshotAsset),
      totals: {
        assetCount: res.assets.length,
        usdNotional: notional,
        unpricedCount: unpriced,
      },
    };
  } catch (e) {
    const msg = String((e as { message?: string }).message ?? e);
    return { ...base, status: "error", error: msg.slice(0, 200) };
  } finally {
    provider.destroy();
  }
}
