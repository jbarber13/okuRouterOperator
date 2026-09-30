/**
 * address.ts
 *
 * Address normalization, in its own module so that everything which needs it
 * can depend on it without depending on feeScan.
 *
 * It lives here rather than in feeScan.ts because feeScan now imports the
 * DefiLlama price source, and that source needs to normalize addresses too.
 * Leaving the helper in feeScan would make those two modules mutually
 * dependent -- which happens to work under CommonJS as long as every call is
 * lazy, but only by accident. A leaf module with no imports of its own cannot
 * participate in a cycle at all.
 */
import { getAddress } from "ethers";

/**
 * Checksum an address without validating the one it arrived with.
 *
 * ethers implements EIP-55, but Rootstock (and other chains) use EIP-1191,
 * which mixes the chainId into the checksum -- so an address that is
 * perfectly valid there fails EIP-55 validation. chain-config stores
 * addresses in each chain's native form, and `getAddress` on Rootstock's USDC
 * throws "bad address checksum", which previously took out valuation, and
 * therefore the entire scan, for that chain.
 *
 * Lowercasing first means we never validate an incoming checksum, only
 * recompute one. A malformed address (wrong length, non-hex) is still
 * rejected, which is the check that actually matters.
 *
 * Returns undefined rather than throwing so callers decide whether a bad
 * address is fatal.
 */
export function toChecksum(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return getAddress(value.trim().toLowerCase());
  } catch {
    return undefined;
  }
}
