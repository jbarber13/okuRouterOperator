/**
 * feeTokens.ts
 *
 * The curated, committed list of tokens each router is swept for:
 * data/fee-tokens.json.
 *
 * WHY THIS REPLACES DISCOVERY
 *
 * Fees are just the router's own ERC20 balances, and `sweepAll` takes nothing
 * but a list of token addresses: it reads balanceOf(this) per entry at
 * execution, transfers the full balance, and SKIPS zero balances without
 * calling transfer (OkuRouter.sol:125-151). So a sweep never needs to know
 * what the router holds -- only which tokens to ask about. A reviewed,
 * version-controlled list answers that without scanning a 40,000-entry
 * published list every cycle, and it makes the calldata reproducible:
 * a `full`-mode chain signs the SAME token array every cycle, so signers can
 * recognise it.
 *
 * Additions happen by review (`fees:tokens --bootstrap` once, then
 * `fees:audit --write` / post-exec reports), never silently at build time.
 *
 * SWEEP MODES
 *
 *   full     every listed token goes into the calldata. Zero balances cost
 *            ~8.2k gas each (measured on base) and are skipped on chain.
 *   nonzero  only listed tokens whose balance is > 0 at build time.
 *   auto     full, unless the EXTRA gas of the zero-balance entries costs more
 *            than `fullSweepMaxUsd` at build-time gas and native price -- then
 *            nonzero. An unknown cost (no gas or native price) resolves to
 *            nonzero: the cheap direction to be wrong in.
 */
import * as fs from "fs";
import * as path from "path";
import { toChecksum } from "./address";
import { _internal as universeInternal } from "./tokenUniverse";

export const FEE_TOKENS_FILE = path.resolve(__dirname, "..", "data", "fee-tokens.json");

export type SweepMode = "auto" | "full" | "nonzero";

export interface FeeTokenEntry {
  address: string;
  symbol: string;
  /** null when decimals() is unreadable; sweepAll does not need it. */
  decimals: number | null;
  /** Comma-joined provenance: seed, chain-config, swept, tokenlist-balance, audit, manual. */
  source: string;
  addedAt: string;
}

export interface FeeTokenExclusion {
  address: string;
  symbol?: string;
  reason: string;
  excludedAt: string;
}

export interface FeeTokenChain {
  network: string;
  mode: SweepMode;
  tokens: FeeTokenEntry[];
  /** Candidates rejected during bootstrap/audit, kept so they are not re-proposed blindly. */
  excluded?: FeeTokenExclusion[];
}

export interface FeeTokensFile {
  kind: "oku-fee-tokens";
  schemaVersion: 1;
  /** auto-mode limit: USD cost of the zero-balance entries a full list adds. */
  fullSweepMaxUsd: number;
  updatedAt: string;
  chains: Record<string, FeeTokenChain>;
}

export const DEFAULT_FULL_SWEEP_MAX_USD = 0.1;

/** Chains forced to a mode regardless of the auto rule, applied at bootstrap. */
export const DEFAULT_MODE_OVERRIDES: Record<number, SweepMode> = {
  // Mainnet gas can spike 10-50x between building and executing a bundle.
  1: "nonzero",
};

export function emptyFeeTokens(): FeeTokensFile {
  return {
    kind: "oku-fee-tokens",
    schemaVersion: 1,
    fullSweepMaxUsd: DEFAULT_FULL_SWEEP_MAX_USD,
    updatedAt: new Date().toISOString(),
    chains: {},
  };
}

/** Validate and normalise a parsed file. Throws on anything structurally wrong. */
export function parseFeeTokens(raw: unknown): FeeTokensFile {
  const f = raw as FeeTokensFile;
  if (!f || f.kind !== "oku-fee-tokens" || f.schemaVersion !== 1) {
    throw new Error("fee-tokens: not an oku-fee-tokens v1 file");
  }
  if (!(typeof f.fullSweepMaxUsd === "number" && f.fullSweepMaxUsd >= 0)) {
    throw new Error("fee-tokens: fullSweepMaxUsd must be a non-negative number");
  }
  for (const [id, c] of Object.entries(f.chains ?? {})) {
    if (!Number.isInteger(Number(id))) throw new Error(`fee-tokens: bad chainId key ${id}`);
    if (!["auto", "full", "nonzero"].includes(c.mode)) {
      throw new Error(`fee-tokens: chain ${id} has invalid mode ${c.mode}`);
    }
    const seen = new Set<string>();
    for (const t of c.tokens ?? []) {
      const a = toChecksum(t.address);
      if (!a) throw new Error(`fee-tokens: chain ${id} has malformed address ${t.address}`);
      if (seen.has(a)) throw new Error(`fee-tokens: chain ${id} lists ${a} twice`);
      seen.add(a);
      t.address = a;
    }
  }
  return f;
}

export function loadFeeTokens(file = FEE_TOKENS_FILE): FeeTokensFile {
  if (!fs.existsSync(file)) {
    throw new Error(
      `fee-tokens: ${path.relative(process.cwd(), file)} not found. ` +
        `Run \`npx hardhat fees:tokens --bootstrap\` to create it.`,
    );
  }
  return parseFeeTokens(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** Sorted, stable serialisation so diffs show only real changes. */
export function saveFeeTokens(f: FeeTokensFile, file = FEE_TOKENS_FILE): void {
  const chains: Record<string, FeeTokenChain> = {};
  for (const id of Object.keys(f.chains).sort((a, b) => Number(a) - Number(b))) {
    const c = f.chains[id];
    chains[id] = {
      network: c.network,
      mode: c.mode,
      tokens: sortTokens(c.tokens),
      ...(c.excluded?.length ? { excluded: sortTokens(c.excluded) } : {}),
    };
  }
  const out: FeeTokensFile = { ...f, updatedAt: new Date().toISOString(), chains };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Canonical order: by lowercase address. This is the order that goes into the
 * calldata, so it must not depend on insertion history -- adding a token must
 * change the array in exactly one place.
 */
export function sortTokens<T extends { address: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) =>
    a.address.toLowerCase() < b.address.toLowerCase() ? -1 : a.address.toLowerCase() > b.address.toLowerCase() ? 1 : 0,
  );
}

/**
 * The sweepable token addresses for a chain, in calldata order.
 *
 * Re-applies the NOT_A_TOKEN / UNSWEEPABLE guards from tokenUniverse.ts even
 * though bootstrap already filtered them: a hand edit to the JSON must not be
 * able to put a sweep-breaking address into a bundle.
 */
export function sweepTokensFor(
  f: FeeTokensFile,
  chainId: number,
): { tokens: FeeTokenEntry[]; dropped: { address: string; reason: string }[] } {
  const c = f.chains[String(chainId)];
  if (!c) return { tokens: [], dropped: [] };
  const unsweepable = universeInternal.UNSWEEPABLE[chainId] ?? {};
  const dropped: { address: string; reason: string }[] = [];
  const tokens: FeeTokenEntry[] = [];
  for (const t of sortTokens(c.tokens)) {
    if (universeInternal.NOT_A_TOKEN.has(t.address)) {
      dropped.push({ address: t.address, reason: "NOT_A_TOKEN (native mirror / sentinel)" });
    } else if (unsweepable[t.address]) {
      dropped.push({ address: t.address, reason: unsweepable[t.address] });
    } else {
      tokens.push(t);
    }
  }
  return { tokens, dropped };
}

export interface ModeDecision {
  mode: "full" | "nonzero";
  reason: string;
  /** USD cost of the zero-balance entries a full list would add; null if unknown. */
  extraUsd: number | null;
}

/**
 * Pick the sweep mode for one chain. Pure, so it is unit-testable.
 *
 * `extraGas` is estimateGas(full list) - estimateGas(nonzero list): the cost
 * of the entries that will move nothing. That, not the total, is what a full
 * list adds -- the real transfers are paid either way.
 */
export function chooseSweepMode(args: {
  configured: SweepMode;
  maxUsd: number;
  extraGas: bigint | null;
  gasPriceWei: bigint | null;
  nativeUsd: number | null;
  zeroEntries: number;
}): ModeDecision {
  const { configured, maxUsd, extraGas, gasPriceWei, nativeUsd, zeroEntries } = args;
  const cost =
    extraGas !== null && gasPriceWei !== null && nativeUsd !== null && nativeUsd > 0
      ? (Number(extraGas * gasPriceWei) / 1e18) * nativeUsd
      : null;
  if (configured === "full") return { mode: "full", reason: "configured full", extraUsd: cost };
  if (configured === "nonzero") {
    return { mode: "nonzero", reason: "configured nonzero", extraUsd: cost };
  }
  if (zeroEntries === 0) {
    return { mode: "full", reason: "auto: every listed token holds a balance", extraUsd: 0 };
  }
  if (cost === null) {
    const missing =
      extraGas === null ? "gas estimate" : gasPriceWei === null ? "gas price" : "native USD price";
    return { mode: "nonzero", reason: `auto: ${missing} unavailable, cost unknown`, extraUsd: null };
  }
  const fmt = `$${cost.toFixed(4)} for ${zeroEntries} empty entr${zeroEntries === 1 ? "y" : "ies"}`;
  return cost <= maxUsd
    ? { mode: "full", reason: `auto: ${fmt} <= $${maxUsd.toFixed(2)}`, extraUsd: cost }
    : { mode: "nonzero", reason: `auto: ${fmt} > $${maxUsd.toFixed(2)}`, extraUsd: cost };
}

/** Find the minimal set of entries that make `simulate` fail, by halving. */
export async function bisectFailures<T>(
  items: readonly T[],
  simulate: (subset: readonly T[]) => Promise<boolean>,
): Promise<T[]> {
  if (items.length === 0) return [];
  if (await simulate(items)) return [];
  if (items.length === 1) return [...items];
  const mid = Math.ceil(items.length / 2);
  const left = await bisectFailures(items.slice(0, mid), simulate);
  const right = await bisectFailures(items.slice(mid), simulate);
  if (left.length === 0 && right.length === 0) {
    // Fails only in combination (e.g. gas). Report the whole group rather
    // than pretend nothing is wrong.
    return [...items];
  }
  return [...left, ...right];
}
