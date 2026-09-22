# Vendored TypeChain bindings

This repo compiles no Solidity, so it cannot generate its own TypeChain
output. `common.ts`, `contracts/OkuRouter.ts` and
`factories/contracts/OkuRouter__factory.ts` are copied verbatim from
okuRouter's generated `typechain-types/`, plus a hand-written `index.ts`
that re-exports just `OkuRouter` and `OkuRouter__factory` -- the only two
symbols anything in this repo imports.

## Why this is safe

OkuRouter's contract source is audited and byte-frozen (see okuRouter's
README, "Contract formatting is frozen"). The ABI these bindings encode does
not change without a `CONTRACT_VERSION` bump and a full redeploy, which is a
rare, deliberate event -- not something that happens as a side effect of
routine work in either repo.

## When to refresh

Only after okuRouter ships a contract change that touches `OkuRouter`'s
public interface (new/changed/removed function or event). In that case:

```bash
# in okuRouter, after `npx hardhat compile`:
cp typechain-types/common.ts                              <this repo>/typechain-types/
cp typechain-types/contracts/OkuRouter.ts                 <this repo>/typechain-types/contracts/
cp typechain-types/factories/contracts/OkuRouter__factory.ts <this repo>/typechain-types/factories/contracts/
```

`index.ts` needs no changes unless the set of exported symbols changes.
After refreshing, run `npm run lint` and `npm test` here to confirm nothing
that depends on the old shape broke.

Do not hand-edit the three copied files -- they are generated code, treated
as such by `eslint.config.mjs`, and any manual edit will be silently
overwritten by the next refresh.
