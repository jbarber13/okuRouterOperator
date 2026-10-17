/**
 * sweepCall.ts
 *
 * Encoding and simulation of the one call a sweep makes:
 * OkuRouter.sweepAll(address[] tokens, bool includeEth, address to).
 *
 * Shared by safe:build, fees:tokens and the tests so the calldata a bundle
 * carries and the calldata that was vetted are produced by the same code.
 */
import type { JsonRpcProvider } from "ethers";
import { OkuRouter__factory } from "../typechain-types";
import { decodeRevert } from "./safeTx";

export const ROUTER_IFACE = OkuRouter__factory.createInterface();
export const SWEEP_ALL_SELECTOR = ROUTER_IFACE.getFunction("sweepAll")!.selector;

/** Fallback ceiling on one sweepAll's gas when the block gas limit is unreadable. */
export const MAX_SWEEP_GAS = 15_000_000n;

/**
 * Per-chain ceiling: half the latest block's gas limit. Gas units are not
 * comparable across chains (filecoin's FEVM charges ~30M for a 7-token sweep
 * against a 10B block limit), so a single constant would be wrong somewhere.
 * Half a block leaves room for the Safe's own overhead and for the block to
 * actually include it.
 */
export async function sweepGasCap(provider: JsonRpcProvider): Promise<bigint> {
  try {
    const b = await provider.getBlock("latest");
    if (b?.gasLimit && b.gasLimit > 0n) return b.gasLimit / 2n;
  } catch {
    /* fall through */
  }
  return MAX_SWEEP_GAS;
}

export function encodeSweepAll(tokens: readonly string[], includeEth: boolean, to: string): string {
  return ROUTER_IFACE.encodeFunctionData("sweepAll", [[...tokens], includeEth, to]);
}

export function decodeSweepAll(data: string): { tokens: string[]; includeEth: boolean; to: string } {
  const [tokens, includeEth, to] = ROUTER_IFACE.decodeFunctionData("sweepAll", data);
  return { tokens: [...(tokens as string[])], includeEth: Boolean(includeEth), to: String(to) };
}

export interface SweepSimResult {
  ok: boolean;
  reason?: string;
}

/** eth_call sweepAll from the Safe (the router owner). */
export async function simulateSweep(
  provider: JsonRpcProvider,
  safe: string,
  router: string,
  tokens: readonly string[],
  includeEth: boolean,
  to: string,
): Promise<SweepSimResult> {
  try {
    await provider.call({ from: safe, to: router, data: encodeSweepAll(tokens, includeEth, to) });
    return { ok: true };
  } catch (e) {
    const anyE = e as { data?: string; shortMessage?: string; message?: string };
    const reason = (anyE.data ? decodeRevert(anyE.data) : undefined) ?? anyE.shortMessage ?? anyE.message;
    return { ok: false, reason: String(reason).slice(0, 160) };
  }
}

/** estimateGas for sweepAll from the Safe, or null if the node refuses. */
export async function estimateSweepGas(
  provider: JsonRpcProvider,
  safe: string,
  router: string,
  tokens: readonly string[],
  includeEth: boolean,
  to: string,
): Promise<bigint | null> {
  if (tokens.length === 0 && !includeEth) return 0n;
  try {
    return await provider.estimateGas({
      from: safe,
      to: router,
      data: encodeSweepAll(tokens, includeEth, to),
    });
  } catch {
    return null;
  }
}
