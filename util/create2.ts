/**
 * create2.ts
 *
 * Minimal CREATE2 helpers, vendored out of okuRouter's util/contractMeta.ts.
 * Only the two symbols the Safe deployment tasks actually use are copied
 * here -- everything else in contractMeta.ts (OkuRouter/Permit2Proxy salts,
 * contract name/version) is deployment bookkeeping this repo has no reason
 * to touch, since it deploys no OkuRouter or Permit2Proxy contracts.
 *
 * SAFE_SINGLETON_FACTORY is Safe's own canonical CREATE2 deployer (see
 * https://github.com/safe-global/safe-singleton-factory), already present
 * at this address on all 34 chains we operate on. It is unrelated to and
 * does not change with anything in okuRouter's contractMeta.ts.
 */
import { getAddress, keccak256, solidityPacked } from "ethers";

export const SAFE_SINGLETON_FACTORY = "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7";

export function computeCreate2Address(
  factory: string,
  salt: string,
  initCodeHash: string,
): string {
  const packed = solidityPacked(
    ["bytes1", "address", "bytes32", "bytes32"],
    ["0xff", factory, salt, initCodeHash],
  );
  return getAddress("0x" + keccak256(packed).slice(-40));
}
