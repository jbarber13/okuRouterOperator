/**
 * feeDiscovery.ts
 *
 * Turn balance-API holdings (balanceDiscovery.ts) into additions to the
 * curated sweep list, automatically, inside `fees:cycle`.
 *
 * For each chain the API covers, every held ERC20 that is not already
 * listed, excluded, or ignored-at-the-same-balance is:
 *
 *   1. re-read ON CHAIN (balanceOf + decimals/symbol via Multicall3). The API
 *      only says where to look; it never supplies a number we use.
 *   2. priced through the normal chain (alias -> DefiLlama -> GeckoTerminal).
 *      Only a FIRM value >= minUsd passes. Everything else -- spam airdrops,
 *      dust, thin or no market -- goes to `ignored` with the reason and the
 *      balance it was judged at, and is not looked at again until that
 *      balance grows.
 *   3. vetted exactly like `fees:audit --write` (feeTokenVet.ts): balanceOf
 *      must answer and a simulated sweepAll of the whole list must not
 *      revert. Failures go to `excluded`.
 *
 * Survivors are added with source `balance-api` and swept in the same cycle.
 * Every addition is reported per chain so it reaches the bundle manifest and
 * the signing page: the calldata changes, and signers must be able to see why.
 */
import { makeProvider, type SafeChain } from "./safeChains";
import { NETWORK_CONFIGS } from "./deploymentConfig";
import { multicallAddressFor, probeBalances, probeMetadata } from "./balanceProbe";
import type { BalanceProbeProvider } from "./balanceProbe";
import { priceAssets, type FeeAsset, type PricedFeeAsset } from "./feeScan";
import { _internal as universeInternal } from "./tokenUniverse";
import {
  DEFAULT_MODE_OVERRIDES,
  sortTokens,
  type FeeTokenChain,
  type FeeTokenIgnored,
  type FeeTokensFile,
} from "./feeTokens";
import { vetChain } from "./feeTokenVet";
import type { DiscoveryChainResult, DiscoveryStatus } from "./balanceDiscovery";

/** Minimum FIRM USD value for a discovered token to be added. */
export const DEFAULT_DISCOVERY_MIN_USD = 1;

export interface DiscoveryAddition {
  token: string;
  symbol: string;
  decimals: number;
  amountRaw: string;
  usdValue: number;
  priceSource?: string;
}

export interface ChainDiscoveryOutcome {
  network: string;
  chainId: number;
  status: DiscoveryStatus;
  /** "alchemy", "ankr", "alchemy+ankr", or "none". */
  source: string;
  /** ERC20s the API reported holding. */
  held: number;
  /** Of those, how many needed evaluating this run. */
  evaluated: number;
  added: DiscoveryAddition[];
  /** Newly ignored (or re-ignored at a higher balance) this run. */
  ignored: { token: string; symbol?: string; reason: string; usdValueThin?: number }[];
  /** Tokens the vet put in `excluded` this run (new or pre-existing entries). */
  excluded: { token: string; reason: string }[];
  warnings: string[];
  /** Set when the chain was covered but evaluation could not complete. */
  error?: string;
}

/** Pure: which held tokens need evaluating this run, and why the rest do not. */
export function selectCandidates(
  chainId: number,
  entry: FeeTokenChain | undefined,
  held: Map<string, bigint>,
): Map<string, bigint> {
  const listed = new Set((entry?.tokens ?? []).map((t) => t.address));
  const excluded = new Set((entry?.excluded ?? []).map((t) => t.address));
  const ignored = new Map((entry?.ignored ?? []).map((t) => [t.address, BigInt(t.balanceRaw)]));
  const unsweepable = universeInternal.UNSWEEPABLE[chainId] ?? {};
  const out = new Map<string, bigint>();
  for (const [tok, bal] of held) {
    if (bal <= 0n) continue;
    if (universeInternal.NOT_A_TOKEN.has(tok) || unsweepable[tok]) continue;
    if (listed.has(tok) || excluded.has(tok)) continue;
    const was = ignored.get(tok);
    if (was !== undefined && bal <= was) continue;
    out.set(tok, bal);
  }
  return out;
}

/** Pure: does this priced asset clear the bar, and if not, why not. */
export function judge(a: PricedFeeAsset, minUsd: number): { pass: true } | { pass: false; reason: string } {
  if (a.usdValue !== undefined) {
    return a.usdValue >= minUsd
      ? { pass: true }
      : { pass: false, reason: `firm $${a.usdValue.toFixed(4)} < $${minUsd}` };
  }
  if (a.usdValueThin !== undefined) {
    return { pass: false, reason: `thin price only ($${a.usdValueThin.toFixed(4)}, ${a.priceSource ?? "?"})` };
  }
  return { pass: false, reason: `no price (${a.priceSource ?? "unpriced"})` };
}

function sourceLabel(found: DiscoveryChainResult | undefined): string {
  return found?.providers.length ? found.providers.join("+") : "none";
}

function setIgnored(entry: FeeTokenChain, items: FeeTokenIgnored[]): void {
  const m = new Map((entry.ignored ?? []).map((i) => [i.address, i]));
  for (const i of items) m.set(i.address, i);
  entry.ignored = sortTokens([...m.values()]);
}

export interface ApplyDiscoveryOpts {
  safe: string;
  minUsd?: number;
  /** Injection points for tests. */
  vet?: typeof vetChain;
  price?: typeof priceAssets;
  provider?: BalanceProbeProvider & { destroy?: () => void };
}

/**
 * Evaluate one chain's discovered holdings and merge additions into `file`
 * (mutated in place). Never throws; failures land in `error`/`warnings` and
 * leave the curated entry as it was.
 */
export async function applyDiscovery(
  chain: SafeChain,
  file: FeeTokensFile,
  found: DiscoveryChainResult | undefined,
  opts: ApplyDiscoveryOpts,
): Promise<ChainDiscoveryOutcome> {
  const minUsd = opts.minUsd ?? DEFAULT_DISCOVERY_MIN_USD;
  const out: ChainDiscoveryOutcome = {
    network: chain.network,
    chainId: chain.chainId,
    status: found?.status ?? "unsupported",
    source: sourceLabel(found),
    held: found?.balances.size ?? 0,
    evaluated: 0,
    added: [],
    ignored: [],
    excluded: [],
    warnings: [...(found?.warnings ?? [])],
  };
  if (!found || found.status !== "covered" || !chain.router || !chain.rpcUrl) return out;

  const key = String(chain.chainId);
  const existing = file.chains[key];
  const candidates = selectCandidates(chain.chainId, existing, found.balances);
  out.evaluated = candidates.size;
  if (candidates.size === 0) return out;

  const cfg = NETWORK_CONFIGS[chain.network];
  const provider =
    opts.provider ?? (makeProvider(chain.rpcUrl, chain.chainId) as unknown as BalanceProbeProvider & { destroy: () => void });
  const now = new Date().toISOString();
  try {
    // 1. on-chain truth
    const multicall = multicallAddressFor(cfg);
    const probe = await probeBalances(provider, chain.router, candidates.keys(), { multicall });
    if (!probe.available) throw new Error(probe.warnings.join("; ") || "multicall unavailable");
    if (probe.unchecked > 0) throw new Error(`${probe.unchecked} discovered token(s) could not be read on chain`);
    const { meta } = await probeMetadata(provider, probe.balances.keys(), { multicall });

    const ignoredNow: FeeTokenIgnored[] = [];
    const ignore = (token: string, symbol: string | undefined, reason: string, bal: bigint, usdValueThin?: number) => {
      ignoredNow.push({ address: token, ...(symbol ? { symbol } : {}), reason, balanceRaw: bal.toString(), ignoredAt: now });
      out.ignored.push({ token, symbol, reason, ...(usdValueThin !== undefined ? { usdValueThin } : {}) });
    };

    const assets: FeeAsset[] = [];
    for (const [tok, apiBal] of candidates) {
      const bal = probe.balances.get(tok);
      if (!probe.responding.has(tok)) {
        ignore(tok, undefined, "balanceOf(router) did not return a word", apiBal);
        continue;
      }
      if (bal === undefined) continue; // API is stale; nothing there now. Look again next time.
      const m = meta.get(tok);
      if (!m) {
        ignore(tok, undefined, "decimals() unreadable; amount cannot be valued", bal);
        continue;
      }
      assets.push({ token: tok, symbol: m.symbol, decimals: m.decimals, balance: bal });
    }

    // 2. value
    const passing = new Map<string, PricedFeeAsset>();
    if (assets.length) {
      const { priced, warnings } = await (opts.price ?? priceAssets)(
        provider as never,
        cfg,
        assets,
        { feeTokens: file },
      );
      out.warnings.push(...warnings);
      for (const p of priced) {
        const j = judge(p, minUsd);
        if (j.pass) passing.set(p.token, p);
        else ignore(p.token, p.symbol, j.reason, p.balance, p.usdValueThin);
      }
    }

    const entry: FeeTokenChain = existing ?? {
      network: chain.network,
      mode: DEFAULT_MODE_OVERRIDES[chain.chainId] ?? "auto",
      tokens: [],
    };
    if (ignoredNow.length) setIgnored(entry, ignoredNow);

    // 3. vet and merge
    if (passing.size) {
      const before = new Set((entry.excluded ?? []).map((e) => e.address));
      const r = await (opts.vet ?? vetChain)(
        chain,
        entry,
        new Map([...passing.keys()].map((a) => [a, new Set(["balance-api"])])),
        opts.safe,
      );
      // The gas-cap message is advisory (the list was merged; safe:build will
      // pick nonzero). Anything else means the vet did not run to completion.
      if (r.error && !/must run nonzero/.test(r.error)) {
        out.error = `vet failed: ${r.error}`;
      } else if (r.error) {
        out.warnings.push(`${chain.network}: ${r.error}`);
      }
      for (const t of r.added) {
        const p = passing.get(t.address);
        if (!p) continue;
        out.added.push({
          token: t.address,
          symbol: t.symbol,
          decimals: p.decimals,
          amountRaw: p.balance.toString(),
          usdValue: p.usdValue!,
          priceSource: p.priceSource,
        });
      }
      for (const e of r.excluded) if (!before.has(e.address)) out.excluded.push({ token: e.address, reason: e.reason });
    }
    if (!existing && (entry.tokens.length || entry.ignored?.length || entry.excluded?.length)) {
      file.chains[key] = entry;
    }
  } catch (e) {
    out.error = String((e as Error).message ?? e).slice(0, 200);
  } finally {
    if (!opts.provider) provider.destroy?.();
  }
  return out;
}
