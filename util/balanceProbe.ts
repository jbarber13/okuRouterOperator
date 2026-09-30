/**
 * balanceProbe.ts
 *
 * Ask one chain "which of these thousands of tokens does the router actually
 * hold?" in a handful of `eth_call`s, using Multicall3.
 *
 * WHY
 *
 * Discovery by `eth_getLogs` is bounded by whatever block range the endpoint
 * deigns to serve, and that bound is invisible until you are rejected. A
 * `balanceOf` probe has no such property: it reads head state, needs no
 * archive node, and works on chains that serve no logs at all. Batched through
 * Multicall3 the entire 33-chain candidate set costs ~87 calls.
 *
 * WHAT IT COSTS TO BE WRONG
 *
 * Nothing silently. Every failure mode here is reported:
 *   - Multicall3 not deployed        -> `available: false`, caller skips the probe
 *   - a batch the node refuses       -> split and retried, then counted
 *   - a token that is not an ERC20   -> `allowFailure`, dropped individually
 *
 * The one thing this must never do is return a short list that looks like a
 * complete one. A probe that quietly lost half its batches would read exactly
 * like a router holding half as much, which is the failure mode the whole fee
 * pipeline is built to avoid.
 */
import type { JsonRpcProvider } from "ethers";
import { Interface } from "ethers";
import { toChecksum } from "./feeScan";

/**
 * The canonical CREATE2 Multicall3 address, used on most chains.
 *
 * NOT universal, and assuming it was cost us a chain in testing: xdc deploys
 * Multicall3 at 0x0b1795cc... instead, so probing the canonical address there
 * found no code and skipped the chain entirely. Callers should pass the
 * chain-config address via `opts.multicall` and let this be the fallback.
 */
export const CANONICAL_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * Multicall3 address recorded in chain-config for a network, if any.
 *
 * chain-config is the source of truth here precisely because the address is
 * not always canonical; reading it removes a per-chain assumption from this
 * file rather than adding a table to it.
 */
export function multicallAddressFor(cfg: { chain?: unknown } | undefined): string | undefined {
  const contracts = (cfg?.chain as { contracts?: { multicall3?: { address?: string } } })
    ?.contracts;
  return toChecksum(contracts?.multicall3?.address);
}

const MULTICALL_IFACE = new Interface([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)",
]);

const ERC20_IFACE = new Interface([
  "function balanceOf(address) view returns (uint256)",
]);

/**
 * The provider surface the probe uses.
 *
 * Structural rather than the concrete JsonRpcProvider, for the same reason
 * feeScan.ts defines LogScanProvider: the batch-splitting and decode paths are
 * where a bug silently turns "not checked" into "holds nothing", and that has
 * to be testable against a scripted fake rather than a live chain.
 */
export type BalanceProbeProvider = Pick<JsonRpcProvider, "getCode" | "call">;

/** Tokens per `aggregate3` call. */
export const DEFAULT_BATCH_SIZE = 500;

/**
 * Smallest batch worth retrying with. Below this the split has stopped being
 * a size problem and is something else (endpoint down, bad router address),
 * and halving further just multiplies requests against a failing node.
 */
export const MIN_BATCH_SIZE = 25;

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

/** Decode one `aggregate3` return element into a balance, if it is one. */
function decodeBalance(entry: { success: boolean; returnData: string }): bigint | null {
  if (!entry?.success) return null;
  const data = entry.returnData;
  // A conforming balanceOf returns exactly one word. Some non-standard tokens
  // return empty data on success; treating that as 0 is right, but treating a
  // short-but-nonempty response as a number is not.
  if (!data || data === "0x") return null;
  if (data.length < 66) return null;
  try {
    return BigInt(data.slice(0, 66));
  } catch {
    return null;
  }
}

/**
 * Probe `balanceOf(holder)` for every candidate token.
 *
 * Batches that the node refuses are split and retried rather than abandoned:
 * RPC gas caps and response-size limits vary wildly across these 34 chains,
 * and a fixed batch size that works on mainnet will be rejected somewhere.
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

  let calls = 0;

  // Multicall3 is deployed deterministically, but "deterministic" is not
  // "present" -- confirm rather than discovering it via an opaque revert
  // halfway through, which would look identical to an empty router.
  let code: string;
  try {
    code = await provider.getCode(multicall);
    calls++;
  } catch (e) {
    warnings.push(`multicall3: getCode failed (${String((e as Error).message).slice(0, 80)})`);
    return { available: false, multicall, balances, probed: 0, calls, unchecked: tokens.length, warnings };
  }
  if (code === "0x" || code === "0x0") {
    warnings.push(
      `multicall3 not deployed at ${multicall}; balance probe skipped. Discovery on this ` +
        `chain falls back to eth_getLogs alone.`,
    );
    return { available: false, multicall, balances, probed: 0, calls, unchecked: tokens.length, warnings };
  }

  const holderAddr = toChecksum(holder);
  if (!holderAddr) {
    warnings.push(`balance probe: malformed holder address ${holder}`);
    return { available: false, multicall, balances, probed: 0, calls, unchecked: tokens.length, warnings };
  }

  const callData = ERC20_IFACE.encodeFunctionData("balanceOf", [holderAddr]);
  let unchecked = 0;

  /** Run one batch, halving on failure. Returns calls spent. */
  const runBatch = async (slice: string[]): Promise<void> => {
    const calls3 = slice.map((t) => ({ target: t, allowFailure: true, callData }));
    try {
      const encoded = MULTICALL_IFACE.encodeFunctionData("aggregate3", [calls3]);
      const raw = await provider.call({ to: multicall, data: encoded });
      calls++;
      const [results] = MULTICALL_IFACE.decodeFunctionResult("aggregate3", raw) as unknown as [
        Array<{ success: boolean; returnData: string }>,
      ];
      for (let i = 0; i < slice.length; i++) {
        const bal = decodeBalance(results[i]);
        if (bal !== null && bal > 0n) balances.set(slice[i], bal);
      }
      return;
    } catch (e) {
      calls++;
      if (slice.length <= MIN_BATCH_SIZE) {
        unchecked += slice.length;
        warnings.push(
          `balance probe: a batch of ${slice.length} failed and was not retried ` +
            `(${String((e as Error).message ?? e).slice(0, 80)}); those tokens were NOT checked`,
        );
        return;
      }
      const mid = Math.ceil(slice.length / 2);
      await runBatch(slice.slice(0, mid));
      await runBatch(slice.slice(mid));
    }
  };

  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
  for (let i = 0; i < tokens.length; i += batchSize) {
    await runBatch(tokens.slice(i, i + batchSize));
  }

  if (unchecked > 0) {
    warnings.push(
      `balance probe: ${unchecked}/${tokens.length} candidate(s) could not be checked; ` +
        `a zero result for them means "not looked at", not "holds nothing"`,
    );
  }

  return { available: true, multicall, balances, probed: tokens.length, calls, unchecked, warnings };
}
