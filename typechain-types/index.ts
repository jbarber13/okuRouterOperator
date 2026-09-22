/**
 * Hand-written index for the vendored subset of okuRouter's TypeChain
 * output. See README.md in this directory for what "vendored" means and
 * when to refresh it.
 *
 * Only OkuRouter is bound here -- Permit2Proxy is not called by anything in
 * this repo. If that changes, copy its two generated files from okuRouter
 * the same way and re-export them below.
 */
export type { OkuRouter } from "./contracts/OkuRouter";
export { OkuRouter__factory } from "./factories/contracts/OkuRouter__factory";
