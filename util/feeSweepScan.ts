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
import { sweepTokensFor, type FeeTokensFile } from "./feeTokens";

export interface ChainScanOptions {
  /**
   * The curated list (data/fee-tokens.json). When given, it IS the candidate
   * set -- the same set safe:build sweeps -- and the published list is not
   * consulted. This is the normal path.
   */
  curated?: FeeTokensFile;
  /**
   * Published-list candidates per chainId, for `fees:audit`-style scans that
   * look beyond the curated list. Ignored when `curated` is set.
   */
  tokenListByChain?: Map<number, Set<string>>;
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

  let universe: { tokens: Set<string>; sources: NonNullable<SnapshotChain["probe"]>["sources"]; warnings: string[] };
  if (opts.curated) {
    if (!opts.curated.chains[String(chain.chainId)]) {
      return {
        ...base,
        status: "error",
        error: `not in data/fee-tokens.json; run fees:tokens --bootstrap --networks ${chain.network}`,
      };
    }
    const { tokens, dropped } = sweepTokensFor(opts.curated, chain.chainId);
    universe = {
      tokens: new Set(tokens.map((t) => t.address)),
      sources: { seed: 0, tokenList: 0, chainConfig: 0, curated: tokens.length },
      warnings: dropped.map((d) => `${chain.network}: curated list entry ${d.address} ignored (${d.reason})`),
    };
  } else {
    universe = buildTokenUniverse(chain, opts.tokenListByChain ?? new Map(), cfg);
  }
  const provider = makeProvider(rpc, chain.chainId);
  try {
    const res = await scanChainFees(provider, cfg, chain.router, {
      candidates: universe.tokens,
      price: opts.price !== false,
    });

    const { notional, unpriced, thinUsd, thinCount } = totalUsd(res.assets);

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
        thinUsd,
        thinCount,
      },
    };
  } catch (e) {
    const msg = String((e as { message?: string }).message ?? e);
    return { ...base, status: "error", error: msg.slice(0, 200) };
  } finally {
    provider.destroy();
  }
}
