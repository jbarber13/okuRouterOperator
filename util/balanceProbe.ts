/**
 * balanceProbe.ts
 *
 * Ask one chain "which of these thousands of tokens does the router hold, and
 * what are they?" in a handful of `eth_call`s, using Multicall3.
 *
 * WHY
 *
 * This is the whole of discovery. The router has no fee accounting, so what it
 * holds can only be learned by reading balances. Doing that one token at a
 * time is what made a scan slow: the provider runs with `batchMaxCount: 1`
 * (several of these chains mishandle batched JSON-RPC), so every read is its
 * own HTTP round trip. Batched through Multicall3, the entire 34-chain
 * candidate set costs ~130 calls instead of ~1,700 sequential ones.
 *
 * WHAT IT COSTS TO BE WRONG
 *
 * Nothing silently. Every failure mode is reported:
 *   - Multicall3 not deployed        -> `available: false`, caller degrades
 *   - a batch the node refuses       -> split and retried, then COUNTED
 *   - a token that is not an ERC20   -> `allowFailure`, dropped individually
 *
 * The one thing this must never do is return a short list that looks like a
 * complete one. A probe that quietly lost half its batches would read exactly
 * like a router holding half as much, and since this is now the only discovery
 * mechanism there is no second source to contradict it.
 */
import type { JsonRpcProvider } from "ethers";
import { AbiCoder, Interface, toUtf8String } from "ethers";
import { toChecksum } from "./address";

/**
 * The canonical CREATE2 Multicall3 address, used on most chains.
 *
 * NOT universal, and assuming it was cost us a chain in testing: xdc deploys
 * Multicall3 at 0x0b1795cc... instead, so probing the canonical address there
 * found no code and skipped the chain entirely. Callers should pass the
 * chain-config address via `opts.multicall` and let this be the fallback.
 */
export const CANONICAL_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL_IFACE = new Interface([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)",
]);

const ERC20_IFACE = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const CODER = AbiCoder.defaultAbiCoder();

/**
 * The provider surface the probe uses.
 *
 * Structural rather than the concrete JsonRpcProvider so the batch-splitting
 * and decode paths -- where a bug silently turns "not checked" into "holds
 * nothing" -- can be unit tested against a scripted fake.
 */
export type BalanceProbeProvider = Pick<JsonRpcProvider, "getCode" | "call">;

/** Tokens per `aggregate3` call. */
export const DEFAULT_BATCH_SIZE = 500;

/**
 * Smallest batch worth retrying with. Below this the split has stopped being
 * a size problem and is something else (endpoint down, bad address), and
 * halving further just multiplies requests against a failing node.
 */
export const MIN_BATCH_SIZE = 25;

/**
 * Multicall3 address recorded in chain-config for a network, if any.
 *
 * chain-config is the source of truth precisely because the address is not
 * always canonical; reading it removes a per-chain assumption from this file
 * rather than adding a table to it.
 */
export function multicallAddressFor(cfg: { chain?: unknown } | undefined): string | undefined {
  const contracts = (cfg?.chain as { contracts?: { multicall3?: { address?: string } } })
    ?.contracts;
  return toChecksum(contracts?.multicall3?.address);
}

export interface TokenMeta {
  decimals: number;
  symbol: string;
}

export interface ProbeResult {
  /** False when Multicall3 has no code here; `balances` is then empty. */
  available: boolean;
  /** The Multicall3 address actually used. */
  multicall: string;
  /** Checksummed token -> non-zero raw balance. Zero balances are dropped. */
  balances: Map<string, bigint>;
  /** Candidate addresses submitted. */
  probed: number;
  /** `eth_call`s actually issued, including retries. */
  calls: number;
  /**
   * Candidates in batches that failed even at MIN_BATCH_SIZE. These were NOT
   * checked, and are not evidence of a zero balance.
   */
  unchecked: number;
  warnings: string[];
}

interface BatchOutcome {
  /** returnData per call, or null where the call failed. */
  results: (string | null)[];
  calls: number;
  /** Indices whose batch failed outright and were never evaluated. */
  unchecked: number[];
  warnings: string[];
}

/**
 * Run `calls` through Multicall3, splitting any batch the node refuses.
 *
 * RPC gas caps and response-size limits vary wildly across these 34 chains, so
 * a fixed batch size that works on mainnet will be rejected somewhere. A
 * refused batch is halved rather than abandoned; only when a batch at
 * MIN_BATCH_SIZE still fails do its indices get reported as unchecked.
 */
async function runAggregate3(
  provider: BalanceProbeProvider,
  multicall: string,
  calls: { target: string; callData: string }[],
  batchSize: number,
): Promise<BatchOutcome> {
  const results = new Array<string | null>(calls.length).fill(null);
  const unchecked: number[] = [];
  const warnings: string[] = [];
  let issued = 0;

  const run = async (from: number, to: number): Promise<void> => {
    const slice = calls.slice(from, to);
    if (slice.length === 0) return;
    try {
      const data = MULTICALL_IFACE.encodeFunctionData("aggregate3", [
        slice.map((c) => ({ target: c.target, allowFailure: true, callData: c.callData })),
      ]);
      const raw = await provider.call({ to: multicall, data });
      issued++;
      const [decoded] = MULTICALL_IFACE.decodeFunctionResult("aggregate3", raw) as unknown as [
        Array<{ success: boolean; returnData: string }>,
      ];
      for (let i = 0; i < slice.length; i++) {
        const entry = decoded[i];
        results[from + i] = entry?.success ? entry.returnData : null;
      }
    } catch (e) {
      issued++;
      if (slice.length <= MIN_BATCH_SIZE) {
        for (let i = from; i < to; i++) unchecked.push(i);
        warnings.push(
          `multicall: a batch of ${slice.length} failed and was not retried ` +
            `(${String((e as Error).message ?? e).slice(0, 80)}); those calls were NOT made`,
        );
        return;
      }
      const mid = from + Math.ceil(slice.length / 2);
      await run(from, mid);
      await run(mid, to);
    }
  };

  for (let i = 0; i < calls.length; i += batchSize) {
    await run(i, Math.min(i + batchSize, calls.length));
  }
  return { results, calls: issued, unchecked, warnings };
}

/** Confirm Multicall3 is actually deployed before relying on it. */
async function multicallAvailable(
  provider: BalanceProbeProvider,
  multicall: string,
): Promise<{ ok: boolean; warning?: string }> {
  try {
    const code = await provider.getCode(multicall);
    if (code === "0x" || code === "0x0") {
      return {
        ok: false,
        warning:
          `multicall3 not deployed at ${multicall}; batched reads unavailable on this chain`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      warning: `multicall3: getCode failed (${String((e as Error).message).slice(0, 80)})`,
    };
  }
}

/** Decode one `balanceOf` return, rejecting anything that is not a full word. */
function decodeBalance(data: string | null): bigint | null {
  // A conforming balanceOf returns exactly one word. Some non-standard tokens
  // return empty data on success; treating that as 0 is right, but treating a
  // short-but-nonempty response as a number is not.
  if (!data || data === "0x" || data.length < 66) return null;
  try {
    return BigInt(data.slice(0, 66));
  } catch {
    return null;
  }
}

/**
 * Decode a `symbol()` return.
 *
 * Handles both the ABI string form and the bytes32 form used by older tokens
 * (MKR and friends). A symbol is cosmetic -- it never affects what is swept --
 * so anything undecodable degrades to "?" rather than dropping the asset.
 */
function decodeSymbol(data: string | null): string {
  if (!data || data === "0x") return "?";
  try {
    return CODER.decode(["string"], data)[0] as string;
  } catch {
    // bytes32: trim trailing zero padding, then salvage printable ASCII.
    try {
      const hex = data.slice(2, 66).replace(/(00)+$/, "");
      if (!hex) return "?";
      const s = toUtf8String(`0x${hex}`);
      return /^[ -~]+$/.test(s) ? s : "?";
    } catch {
      return "?";
    }
  }
}

/** Decode a `decimals()` return. Null when absent or implausible. */
function decodeDecimals(data: string | null): number | null {
  if (!data || data === "0x" || data.length < 66) return null;
  try {
    const n = Number(BigInt(data.slice(0, 66)));
    // Anything outside this range is not an ERC20 decimals value; using it
    // would scale an amount by an absurd factor.
    return Number.isInteger(n) && n >= 0 && n <= 36 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Probe `balanceOf(holder)` for every candidate token.
 *
 * This is the discovery step. Everything downstream sees only what comes back
 * from here, which is why `unchecked` is reported rather than folded into
 * "zero balance".
 */
export async function probeBalances(
  provider: BalanceProbeProvider,
  holder: string,
  candidates: Iterable<string>,
  opts: { batchSize?: number; multicall?: string } = {},
): Promise<ProbeResult> {
  const warnings: string[] = [];
  const balances = new Map<string, bigint>();
  const multicall = toChecksum(opts.multicall) ?? CANONICAL_MULTICALL3;

  const tokens: string[] = [];
  for (const raw of candidates) {
    const t = toChecksum(raw);
    if (t) tokens.push(t);
  }
  if (tokens.length === 0) {
    return { available: true, multicall, balances, probed: 0, calls: 0, unchecked: 0, warnings };
  }

  const holderAddr = toChecksum(holder);
  if (!holderAddr) {
    warnings.push(`balance probe: malformed holder address ${holder}`);
    return {
      available: false,
      multicall,
      balances,
      probed: 0,
      calls: 0,
      unchecked: tokens.length,
      warnings,
    };
  }

  const avail = await multicallAvailable(provider, multicall);
  if (!avail.ok) {
    warnings.push(avail.warning!);
    return {
      available: false,
      multicall,
      balances,
      probed: 0,
      calls: 1,
      unchecked: tokens.length,
      warnings,
    };
  }

  const callData = ERC20_IFACE.encodeFunctionData("balanceOf", [holderAddr]);
  const out = await runAggregate3(
    provider,
    multicall,
    tokens.map((t) => ({ target: t, callData })),
    Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE),
  );
  warnings.push(...out.warnings);

  for (let i = 0; i < tokens.length; i++) {
    const bal = decodeBalance(out.results[i]);
    if (bal !== null && bal > 0n) balances.set(tokens[i], bal);
  }

  if (out.unchecked.length > 0) {
    warnings.push(
      `balance probe: ${out.unchecked.length}/${tokens.length} candidate(s) could not be ` +
        `checked; a zero result for them means "not looked at", not "holds nothing"`,
    );
  }

  return {
    available: true,
    multicall,
    balances,
    probed: tokens.length,
    calls: out.calls + 1,
    unchecked: out.unchecked.length,
    warnings,
  };
}

/**
 * Read `decimals()` and `symbol()` for a small set of tokens in one round.
 *
 * Only ever called for tokens already known to hold a balance, so the input is
 * tens of addresses rather than thousands. Tokens whose `decimals` cannot be
 * read are OMITTED: an amount is meaningless without its scale, and defaulting
 * to 18 would silently misreport the balance of every 6-decimal stablecoin.
 */
export async function probeMetadata(
  provider: BalanceProbeProvider,
  tokens: Iterable<string>,
  opts: { batchSize?: number; multicall?: string } = {},
): Promise<{ meta: Map<string, TokenMeta>; calls: number; warnings: string[] }> {
  const warnings: string[] = [];
  const meta = new Map<string, TokenMeta>();
  const multicall = toChecksum(opts.multicall) ?? CANONICAL_MULTICALL3;

  const list: string[] = [];
  for (const raw of tokens) {
    const t = toChecksum(raw);
    if (t) list.push(t);
  }
  if (list.length === 0) return { meta, calls: 0, warnings };

  const decData = ERC20_IFACE.encodeFunctionData("decimals", []);
  const symData = ERC20_IFACE.encodeFunctionData("symbol", []);
  const calls = list.flatMap((t) => [
    { target: t, callData: decData },
    { target: t, callData: symData },
  ]);

  const out = await runAggregate3(
    provider,
    multicall,
    calls,
    Math.max(2, opts.batchSize ?? DEFAULT_BATCH_SIZE),
  );
  warnings.push(...out.warnings);

  const undecodable: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const decimals = decodeDecimals(out.results[i * 2]);
    if (decimals === null) {
      undecodable.push(list[i]);
      continue;
    }
    meta.set(list[i], { decimals, symbol: decodeSymbol(out.results[i * 2 + 1]) });
  }

  if (undecodable.length) {
    warnings.push(
      `metadata: ${undecodable.length} token(s) did not return a usable decimals() and were ` +
        `dropped rather than assumed to be 18: ${undecodable.slice(0, 5).join(", ")}` +
        `${undecodable.length > 5 ? ", ..." : ""}`,
    );
  }

  return { meta, calls: out.calls, warnings };
}

/** Exposed for tests. */
export const _internal = { decodeSymbol, decodeDecimals, decodeBalance, runAggregate3 };
