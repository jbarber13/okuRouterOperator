# Oku Router Operator

Multisig operations and fee collection for OkuRouter's production Safe — the
34-chain deployment owned by a single 2-of-3 hardware wallet multisig. This
repo covers everything that happens **after** a router exists on-chain:
whitelisting swap targets, day-2 admin actions through the Safe, and periodic
protocol-fee collection.

It does not compile, deploy, or redeploy OkuRouter contracts — that lives in
okuRouter. See ["Relationship to okuRouter"](#relationship-to-okurouter)
below for exactly what is vendored from there and why.

## Runbook: collecting fees

The commands for a regular fee-collection ceremony, once a bundle already
exists (see [The regular cycle](#the-regular-cycle--feescycle) for building
one). Only the last step touches a live chain.

```bash
# 1. Each signer pulls, starts the local signing server, signs in the browser
git pull
npm run sign-page
# open http://127.0.0.1:8547/<bundle>/sign.html, connect hardware wallet, sign all chains

# 2. Signer sends their signature file back to the coordinator
#    safe-bundles/<bundle>/signatures-0x<signer>.json

# 3. Coordinator folds each signer's signatures into the bundle
npx hardhat safe:sign --name <bundle> --import safe-bundles/<bundle>/signatures-0x<signer1>.json
npx hardhat safe:sign --name <bundle> --import safe-bundles/<bundle>/signatures-0x<signer2>.json

# 4. Check readiness (2-of-3 reached on every chain)
npx hardhat safe:status

# 5. Dry run -- no broadcast, re-verifies hashes/signatures/nonces and simulates
npx hardhat safe:exec --name <bundle>

# 6. Broadcast for real
npx hardhat safe:exec --name <bundle> --broadcast

# 7. Roll up the accounting artifacts safe:exec wrote automatically
npx hardhat fees:report --rebuild
```

Needs 2 of the 3 hardware-wallet signers (see
[Production multisig](#production-multisig-safe) for addresses). Full detail,
including the sweep-specific signer checklist, safety properties, and how a
bundle gets built in the first place: [Fee collection](#fee-collection).

## Development

```bash
npm install

# Run tests (offline; no RPC needed)
npm test

# Lint
npm run lint
```

Everything else in this repo talks to live chains and needs a `.env` with, at
minimum, `MAINNET_PRIVATE_KEY` (the hot deployer/executor/relayer key — see
[Roles](#roles); it never holds Safe-owner authority) and whichever `<NET>_URL`
overrides you need (see the RPC gotcha notes under
[Swap-target whitelisting](#swap-target-whitelisting) and
[Endpoints](#endpoints--why-discovery-depends-on-them)).

## Relationship to okuRouter

This repo has no build step against okuRouter's Solidity and does not import
it as a dependency. What it needs from there is vendored directly:

- **ABI bindings** — `typechain-types/` carries a hand-picked copy of
  okuRouter's generated `OkuRouter` binding (see
  [`typechain-types/README.md`](typechain-types/README.md) for what, why, and
  how to refresh it after a contract change).
- **Chain/network config** — `util/deploymentConfig.ts` is a duplicate of
  okuRouter's copy. Both must be updated together when chain-config adds a
  network or `knownSwapTargets` changes; there is currently no shared package
  enforcing that.
- **Deployment addresses** — `deployments/*.json` is a snapshot of okuRouter's
  registry at the time of the split. `safe:refresh-registry` (below) keeps
  this copy's `Safe` entries current from live chain state; router redeploys
  still happen in okuRouter and need to be re-synced here by hand.

None of this is a live dependency — a stale vendor copy degrades to slightly
out-of-date config, never to a build failure or a wrong transaction (every
mutating task independently verifies on-chain state before sending anything).

## Swap-target whitelisting

`OkuRouter` will only call an aggregator contract that is registered in its `swapTargets`
mapping. The desired set is **derived from chain-config** — `marketRouters` in
`@gfxlabs/oku-chains` — never from a hardcoded list in this repo. When chain-config
publishes a new aggregator router, the workflow is: bump the dependency, detect the gap,
apply it, confirm.

### 1. Detect — `yarn check:swap-targets` (chain-config repo)

chain-config ships a read-only auditor that checks every configured `marketRouters`
address against `swapTargets` on that chain's `oku.router`, across all `MAINNET_CHAINS`:

```bash
cd ../chain-config && yarn check:swap-targets
```

Requires the [chain-config](https://gfx.cafe/gfx/chain-config) repo checked out alongside
this one. It reads chain state over the internal proxy `https://venn.lat.gfx.town/{internalName}`,
which is considerably more reliable than the public endpoints this repo falls back to.

It prints `all good` and exits `0` when every router is allowed. Otherwise it groups the
offenders by chain and exits non-zero:

```
ethereum (1):
  - 0xBc1D9760bd6ca468CA9fB5Ff2CFbEAC35d86c973 (bitget)
```

Two caveats worth knowing:

- It resolves the router from chain-config's own `oku.router` field, **not** from
  `deployments/*.json` here. If those two disagree, it is auditing a different contract
  than the tasks below will write to.
- It only checks the config → chain direction. An address whitelisted on-chain but absent
  from chain-config will not be reported, since `swapTargets` is a plain mapping with no
  enumeration — that would need a `SwapTargetAdded` event replay.

### 2. Apply — `whitelist-swap-targets` (this repo)

```bash
# preview only; sends nothing
npx hardhat whitelist-swap-targets --dry-run

# restrict to specific chains
npx hardhat whitelist-swap-targets --dry-run --networks mainnet,base,bsc

# live
npx hardhat whitelist-swap-targets --networks mainnet,base,bsc
```

The task diffs `NETWORK_CONFIGS[<network>].knownSwapTargets` against live `swapTargets()`
and registers whatever is missing. It is:

- **idempotent** — only addresses reading back `false` are submitted, so re-running is a
  no-op, and it never removes anything
- **ownership-preflighted** — a chain whose `owner()` is not the configured signer is
  skipped loudly instead of burning gas on a guaranteed revert
- **bytecode-preflighted** — an address with no code is skipped; whitelisting an EOA as a
  swap target is a security footgun
- **post-write verified** — re-reads `swapTargets()` after each tx and only reports success
  if it actually flipped

Prefer `--networks` over a full sweep when you already know the affected chains: it keeps
the run clear of chains that need no work, and of any chain whose ownership has already
moved to the Safe.

### Which path applies

`updateSwapTargets` is `onlyOwner`, and `OkuRouter` is `Ownable2Step` — so the gate is
`owner()`, not `pendingOwner`.

| `owner()` is | use |
| --- | --- |
| the deployer EOA | `npx hardhat whitelist-swap-targets` (above) — one tx per chain, no signatures |
| the production Safe | `npx hardhat safe:build --intent swap-targets` → `safe:sign` → `safe:exec` |

On any chain still owned by the deployer EOA (not yet handed over to the Safe), both paths
technically apply but the EOA path is cheaper — it consumes no Safe nonce, so it cannot
invalidate pre-signed acceptance bundles. Once `acceptOwnership` lands, only the Safe path
works. See [Production multisig](#production-multisig-safe).

### RPC gotcha

Several `.env` entries (`MAINNET_URL`, `BASE_URL`, `BSC_URL`) point at public endpoints
that are prone to being rate-limited or blocking, and `rpcUrl()` in `hardhat.config.ts`
prioritises env overrides **above** Alchemy even when `ALCHEMY_API_KEY` is set and supports
the chain. The failure mode is nasty: the transaction broadcasts fine and then the endpoint
dies during receipt polling, so the task reports a failure for a tx that actually landed.
Always confirm on-chain before retrying. Override per-run:

```bash
MAINNET_URL="https://eth-mainnet.g.alchemy.com/v2/$ALCHEMY_API_KEY" \
BASE_URL="https://base-mainnet.g.alchemy.com/v2/$ALCHEMY_API_KEY" \
BSC_URL="https://bnb-mainnet.g.alchemy.com/v2/$ALCHEMY_API_KEY" \
npx hardhat whitelist-swap-targets --networks mainnet,base,bsc
```

hyperevm's default RPC (`rpc.hyperliquid.xyz/evm`) also intermittently fails to broadcast
with `could not coalesce error`; `HYPEREVM_URL=https://hyperliquid.drpc.org` works.

### 3. Confirm

Re-run the chain-config auditor — `all good` is the authoritative sign-off that on-chain
state matches published config:

```bash
cd ../chain-config && yarn check:swap-targets
```

## Production multisig (Safe)

All 34 OkuRouter deployments are owned by a single **2-of-3 Safe** at one address on every
chain:

```
address    0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F
type       SafeL2 v1.4.1 (L1 singleton + SafeToL2Setup delegatecall)
threshold  2 of 3
saltNonce  0
```

**Signers — all three are hardware wallets.** No signer key exists in software
anywhere, which is why `safe:sign --key-env` is not usable for production signing; see
[Collecting signatures](#collecting-signatures).

| # | Address |
| --- | --- |
| 1 | `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| 2 | `0x5227a7404631Eb7De411232535E36dE8dad318f0` |
| 3 | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200` |

Losing any one device is survivable (2 of the remaining signers still meet the
threshold). Losing two is not. Rotation is an on-chain `swapOwner` through a normal
2-of-3 transaction and does **not** change the Safe address — update `OKU_SAFE_OWNERS`
in `util/safeConfig.ts` afterwards so the config matches the chain.

### Migration status

**The handover is complete on 33 of 34 chains.**

| state | chains |
| --- | --- |
| **Safe owns the router** | **33** |
| Still deployer-owned | 1 — robinhood (Safe not deployed; deployer underfunded) |

Verified on-chain for all 33: `owner()` is the Safe, `pendingOwner()` is cleared, no chain
is paused, and every Safe is at nonce 1. All acceptances were relayed by the deployer EOA
`0x3CB68a…` acting purely as an unprivileged executor — the hardware wallets paid no gas
on any chain.

**Remaining work — robinhood (4663):** send ~0.0015 ETH to
`0x3CB68a6762041aA05E762814A8791CA9d98E79A0` on Robinhood, then

```bash
npx hardhat safe:deploy   --networks robinhood --broadcast
npx hardhat safe:handover --networks robinhood --broadcast
npx hardhat safe:build --intent accept-ownership --networks robinhood
# collect 2 signatures, then
npx hardhat safe:exec --name <bundle> --broadcast
npx hardhat safe:refresh-registry --networks robinhood
```

### Day-2 consequences of the handover

- **`whitelist-swap-targets` no longer works.** It preflights `owner() == signer` and now
  reports `NOT_OWNER` on every handed-over chain — meaning it silently verifies *nothing*.
  Use `safe:build --intent swap-targets` instead, which diffs on-chain state and emits a
  bundle only where something is missing.
- The equivalent EOA-era backfill scripts have been deleted (they stopped working the
  moment ownership moved to the Safe, and a hardcoded address list goes stale as soon as
  chain-config publishes again). Use `safe:build --intent valid-signer` for the backend
  warrant signer.
- Only the Safe can send bare ETH to a router (`receive()` requires `msg.sender == owner()`).
- Every privileged action is now a 2-of-3 ceremony. Chain-config bumps that add new swap
  targets are best reconciled deliberately rather than discovered as drift later.

Bundles and signatures are stored separately, and only one of them is committed:

| path | contents | git |
| --- | --- | --- |
| `safe-bundles/<name>.json` | transaction definition — authorizes nothing | **committed** |
| `safe-bundles/<name>/signatures-0x<addr>.json` | signature material — a `threshold` set is a bearer authorization | gitignored |
| `safe-bundles/<name>/{sign.html,tx-builder,eip712}` | generated, reproducible from the bundle | gitignored |

Committing the definition gives an auditable record of exactly what was approved, lets
co-signers `git pull` instead of being sent a file, and protects work in progress from
`git clean -fdx`. Signatures never enter git history, which cannot be un-published — the
rule is unconditional because it matters far more for a future `sweepAll` or `pause`
bundle than for an `acceptOwnership` batch.

### What we do and do not deploy

We deploy **no Safe contracts**. Safe's canonical v1.4.1 `SafeProxyFactory`, `SafeL2`
singleton, `CompatibilityFallbackHandler` and `MultiSendCallOnly` already exist at
identical addresses on all 34 chains. What we deploy is our own Safe **proxy**, once per
chain — a Safe is a smart contract account, so it does not exist on a chain until its
proxy is there. No app, including app.safe.global, can avoid that.

One known gap: `SafeToL2Setup` is absent on **Gensyn**. It is referenced by the
initializer, so it is part of the address preimage and cannot be skipped without forking
the address there. `safe:deploy` deploys the canonical bytecode to its canonical address
first. The embedded bytecode is self-verifying: it must CREATE2 to `0xBD89A1CE…` through
the Safe Singleton Factory or the task refuses to send it.

> `@safe-global/safe-deployments` does not list Gensyn at all and wrongly reports Telos as
> lacking `SafeToL2Setup`. On-chain `eth_getCode` is the only trustworthy source, which is
> why `safe:preflight` probes every chain instead of trusting a registry.

### Why we script all 34 instead of using app.safe.global

app.safe.global supports 22 of our 34 chains; the other 12 aren't in its network list at
all. Scripting all 34 is also strictly better where the UI *is* available: one
byte-identical code path, we choose the `saltNonce` (the UI picks its own, so the address
wouldn't be knowable in advance), and the address is verified before anything is spent.

You still get the full Safe UI on the 22 supported chains. The Transaction Service indexes
the canonical factory's `ProxyCreation` event regardless of who called it — verified
against the previous Oku Safe, whose creation transaction went through a relayer
intermediary rather than a direct factory call and was indexed completely.

### Roles

| Role | Who | On-chain authority |
| --- | --- | --- |
| Owner | the 3 hardware wallets | 2 signatures execute anything |
| **Executor** | `0x3CB68a…` (hot deployer) | **none** — `execTransaction` is permissionless once the threshold of signatures exists |
| Proposer | `0x3CB68a…` (hot deployer) | **none** — can only queue transactions into the Safe UI; cannot sign, cannot execute |

The executor role is the one that matters operationally: it lets the hot wallet relay and
pay gas on all 34 chains while holding zero permissions, so the hardware wallets never
need a gas balance anywhere. Proposers are a UI convenience only, available on 22 chains,
and reduce the signature count by exactly zero.

Signature collection cannot be collapsed across chains: `chainId` is inside the SafeTx
EIP-712 domain and the nonce is per-chain, so every chain needs its own signature from
every signer. There is no stock-Safe way around that. `MultiSendCallOnly` does collapse
*multiple actions on one chain* into one signature, which is where the real saving is.

### Collecting signatures

All three signers are hardware wallets, so `safe:sign --key-env` (software key) is only
useful for testing. Two production routes, both supported:

**1. Batch signing page (recommended, covers all 34 chains)**

Full operator guide, including the security model and troubleshooting:
**[`scripts/safeSignPage/README.md`](scripts/safeSignPage/README.md)**.
Step-by-step instructions to hand to a non-technical co-signer:
**[`scripts/safeSignPage/SIGNER-GUIDE.md`](scripts/safeSignPage/SIGNER-GUIDE.md)**.

Generate a self-contained page with the bundle already embedded, then serve it:

```bash
npx hardhat safe:sign-page --name accept-all     # -> safe-bundles/accept-all/sign.html
npm run sign-page                                # prints the exact URL to open
```

`npm run sign-page` discovers every generated page and prints its link plus a live
signature count, e.g.:

```
bound to  http://127.0.0.1:8547  (loopback only -- not exposed to your LAN)

Open:

  http://127.0.0.1:8547/accept-all/sign.html
      32 chain(s), 0 signature(s) collected, 0/32 ready to execute
```

Connect MetaMask/Rabby with the hardware device behind it and sign every chain in one
sitting. **Each signature is written to disk the moment it is produced** — the server
verifies it against the Safe's owner list and appends to
`safe-bundles/<bundle>/signatures-<signer>.json`, with a `localStorage` mirror as a second
safety net, so a page reload or server restart cannot lose work. Then:

```bash
npx hardhat safe:sign --name accept-all \
  --import safe-bundles/accept-all/signatures-0x<signer>.json
```

> **Use the `http://127.0.0.1` URL, not a `file://` path.** MetaMask does not inject a
> provider into `file://` pages unless you enable "Allow access to file URLs" in
> chrome://extensions → MetaMask → Details.
>
> The server (`scripts/safeSignPage/serve.js`, plain node, no dependencies) binds
> **127.0.0.1 only** and serves `safe-bundles/` — never the repo root, which contains
> `.env` with a live deployer key. Loopback-only matters: a bundle carrying `threshold`
> signatures is a bearer authorization, and `python3 -m http.server` would bind `0.0.0.0`
> and publish it to your whole LAN. Path traversal out of `safe-bundles/` is rejected.
> Override the port with `PORT=8548 npm run sign-page`.

The page walks the bundle in order, switching networks as it goes and calling
`wallet_addEthereumChain` from the bundle's embedded `chainMeta` for networks the wallet has
never seen. That switching is mandatory, not cosmetic: `eth_signTypedData_v4` is refused
when the active chain does not match the SafeTx domain. It re-reads `eth_chainId` before
each signature so a silent mismatch cannot produce a signature over the wrong domain, and
shows the expected `safeTxHash` beside each chain for device comparison. Wallets are
discovered via EIP-6963 (with a `window.ethereum` fallback), so MetaMask and Rabby can
coexist and you can pick which one your device sits behind.

Deliberately narrow: it never broadcasts, never handles key material, has no dependencies
and no build step. `npm run check:sign-page` statically asserts those properties — no
`eth_sendTransaction`, no `XMLHttpRequest`/`WebSocket`/`sendBeacon`, no `eval`, no dynamic
import, no remote script, and at most a single same-origin `fetch` used only to autoload a
local bundle (the generated page embeds the bundle and fetches nothing at all).

It is a convenience, not a trusted component. Every signature is re-verified downstream:
`safe:sign --import` independently recovers the signer and rejects anything that is not a
current owner, and `safe:exec` re-derives each hash, re-validates every signature and
re-checks the live Safe nonce before spending gas.

**2. app.safe.global (the 22 chains with a hosted service)**

Import `<bundle>/tx-builder/<chain>.json` via Transaction Builder, sign with the device,
then relay with `safe:exec --from-service --broadcast` so the owners never pay gas.

> **Sign off-chain, not on-chain.** The Safe UI may offer to "approve" a transaction with
> an on-chain `approveHash` transaction instead of an off-chain signature. Avoid it: it
> costs the signer gas on every chain, which at 34 chains means funding every hardware
> wallet on every network — including exotic ones. An off-chain signature costs nothing and
> the relayer pays. Confirmed working with a Trezor Model T (`signatureType: EOA`).

### Tasks

```bash
npx hardhat safe:predict      # offline: address, initializer, salt, target chain list
npx hardhat safe:preflight    # read-only GO/NO-GO across all 34 chains
npx hardhat safe:deploy       # deploy the Safe proxy       (DRY RUN unless --broadcast)
npx hardhat safe:handover     # transferOwnership from EOA  (DRY RUN unless --broadcast)
npx hardhat safe:build        # diff state -> per-chain SafeTx bundle
npx hardhat safe:sign         # attach signatures to a bundle
npx hardhat safe:exec         # relay execTransaction       (DRY RUN unless --broadcast)
npx hardhat safe:status       # per-chain Safe + router ownership state
npx hardhat safe:proposer     # register the hot wallet as a proposer (22 chains)
npx hardhat safe:refresh-registry   # rewrite deployments/*.json from chain state
npx hardhat fees:cycle        # scan all chains -> sweep bundle -> signing page
npx hardhat fees:scan         # read-only: idle protocol fees per chain
npx hardhat fees:account      # accounting artifact for an executed sweep
npx hardhat fees:report       # roll up collections by date, week or chain
```

Every mutating task is a **dry run by default** and requires `--broadcast`.

### Runbook

**0. Rehearse on forks.** Exercises the whole migration — address parity, `SafeToL2Setup`
migration, `Ownable2Step` sequencing, threshold enforcement, MultiSend batching and the
permissionless executor — with zero real transactions:

```bash
npx hardhat run scripts/testForkSafeMigration.ts
npx hardhat test test/base/SafeConfig.ts
```

**1. Preflight.** Must report `GO`. Note it reports `INCOMPLETE` (not `GO`) when an RPC
failure leaves a check unverified — an unknown is not a pass:

```bash
npx hardhat safe:preflight
```

**2. Deploy the Safe.** Canary one cheap chain first and confirm it can actually execute
a transaction; a deployed Safe is not proof the chain can run `execTransaction`:

```bash
npx hardhat safe:deploy                                  # dry run, all 34
npx hardhat safe:deploy --networks telos --broadcast      # canary
npx hardhat safe:deploy --broadcast                       # the rest
```

**3. Register proposers** (optional, 22 chains). The delegator must be a Safe *owner*, so
this needs a hardware wallet. Easiest via the UI (Settings → Setup → Proposers); for a
scripted run, `safe:proposer --print` emits the exact EIP-712 payloads:

```bash
npx hardhat safe:proposer --list
npx hardhat safe:proposer --print
```

**4. Hand over ownership.** `transferOwnership` only sets `pendingOwner`; the deployer
keeps full control until the Safe accepts. That split is the safety net — if the Safe is
missing or can't transact on some chain, `acceptOwnership` never happens and ownership
stays put. A botched handover is a no-op, not a loss. `safe:handover` independently
re-verifies the Safe's owners, threshold, singleton, fallback handler and module list on
each chain before sending.

```bash
npx hardhat safe:handover --networks telos --broadcast    # step 1: from the deployer EOA
npx hardhat safe:build --intent accept-ownership --networks telos
npx hardhat safe:sign --name accept-ownership-<stamp> --key-env SAFE_SIGNER_KEY
npx hardhat safe:exec --name accept-ownership-<stamp> --networks telos --broadcast
npx hardhat safe:refresh-registry --networks telos
```

Prove one real admin action through the Safe on the canary before touching the other 33.

**5. Day-2 admin.** All privileged actions now go through the three-stage flow:

```bash
npx hardhat safe:build --intent swap-targets
npx hardhat safe:build --intent pause
npx hardhat safe:build --intent valid-signer --address 0x… --add true
npx hardhat safe:build --intent max-warrant-duration --seconds 300
```

`safe:build` diffs on-chain state so only chains that need work appear, batches multiple
calls per chain into one `MultiSendCallOnly` transaction, verifies every `safeTxHash`
against the Safe's own `getTransactionHash()`, and simulates each inner call from the Safe
address — all before anyone signs.

It writes three artifacts under `safe-bundles/<name>/`:

- the bundle itself (accumulates signatures)
- `tx-builder/<chain>.json` — importable at app.safe.global (22 chains)
- `eip712/<chain>.json` — raw payloads for `safe-cli --trezor` / offline signers (all 34)

Then collect signatures and relay:

```bash
# owners signed in the Safe UI -> pull their confirmations and relay (hot wallet pays gas)
npx hardhat safe:exec --name <bundle> --from-service --broadcast

# or fold in signatures produced by an external hardware-wallet tool
npx hardhat safe:sign --name <bundle> --import sigs.json
npx hardhat safe:exec --name <bundle> --broadcast
```

`safe:exec` re-derives every hash from the stored fields, recovers each signature to a
real owner, checks the live Safe nonce hasn't advanced (stale signatures), and simulates
the full `execTransaction` before spending gas.

> The bundle definition **is** committed — it authorizes nothing on its own and is the
> record of exactly what was proposed. **Signatures are not.** They live in gitignored
> per-signer sidecars (`signatures-0x<addr>.json`), because a set of `threshold`
> signatures is a bearer authorization: anyone holding it can execute the transaction.

### Accepted limitations

Recorded deliberately, not oversights:

- **Pause latency.** Pausing all 34 routers needs 2 hardware signatures × 34 chains.
  Realistically 30–60 minutes. There is no guardian module and no contract change.
- **2-of-3 with `sweepAll`.** Any two compromised devices can sweep fees on all 34 chains.
  A third lost device is survivable; two are not.
- **`renounceOwnership()`** is present in the OkuRouter ABI and is not disabled. It needs
  a deliberate 2-of-3 to call, but it would permanently brick all admin functions.
- **zkSync Era** is incompatible with this CREATE2 replay (different address derivation).
  `zksync` is configured but not deployed; if OkuRouter ever ships there its Safe will be
  at a *different* address.

## Fee collection

Protocol fees accumulate as the router's own token and ETH balance. There is
**no fee accounting in the contract** — no `collectableFees()` view, no
per-token mapping. The only way to know what is there is to work out which
assets have flowed through (`OrderFilled.tokenIn`) and read `balanceOf`. That
is what `fees:scan` does.

Collection is `sweepAll(address[] tokens, bool includeEth, address to)`, which
is `onlyOwner` and therefore a Safe transaction. It always moves the **full**
balance of each listed asset; there is no amount parameter.

Fees are swept to `OKU_FEE_RECIPIENT` (`util/safeConfig.ts`). It is a
committed constant rather than a `--to` flag because a sweep is irreversible,
so the destination belongs in a reviewable diff instead of being retyped into
a shell each time. `--to` still exists for one-off recoveries.

### Who runs what

The scan is a **coordinator-only** step. Signers never run it.

| Role | Runs | Needs |
| --- | --- | --- |
| Coordinator | `fees:cycle`, then `safe:exec` | RPC endpoints, relayer key, ~15 min |
| Signer | `npm run sign-page`, then signs in the browser | this repo, `npm install`, a hardware wallet |

`fees:cycle` decides which chains are in play and writes that into the bundle,
which **is committed**. A signer pulls, runs `npm run sign-page`, and gets a
page containing exactly the chains that hold fees — no RPC endpoints, no API
keys, no `.env`, no scanning, no waiting. Chains that are empty are dropped
before the bundle exists, so they never reach a signing device. Selection is
by non-zero balance, not by value: a chain holding assets with no USD price
still gets swept.

`sign.html` is gitignored because it is regenerated from the bundle in a
second; `npm run sign-page` rebuilds it, prunes pages for bundles that are
already complete, and prints the URL for what is actually outstanding.

### The regular cycle — `fees:cycle`

One command covers assessing every chain, totalling what is collectable, and
producing the signing page:

```bash
# Look first. Writes a snapshot + markdown report, builds nothing.
npx hardhat fees:cycle --scan-only

# Scan all 34 chains, build the sweep bundle from that exact scan, emit sign.html
npx hardhat fees:cycle

# Then: collect 2 of 3 signatures, dry-run, broadcast.
npm run sign-page                                   # http://127.0.0.1:8547/<name>/sign.html
npx hardhat safe:exec --name sweep-2026-09-29
npx hardhat safe:exec --name sweep-2026-09-29 --broadcast
```

The scan and the build are a single pass on purpose. Discovery — working out
which assets have ever flowed through each router — is the expensive part, and
run separately the two steps pay for it twice. `fees:cycle` scans once and
hands the result to `safe:build --from-scan`.

What the bundle actually needs from the scan is the **token address list**.
`sweepAll(address[] tokens, bool includeEth, address to)` takes no amounts: it
reads `balanceOf` at execution time, moves the entire balance of each listed
token, and silently skips any that are zero. Amounts and USD figures never
enter the calldata. They exist for exactly two purposes — judging whether a
chain is worth a ceremony, and itemizing the manifest signers see — and both
tolerate being approximate. So the snapshot's valuations are reused as-is
rather than re-derived at build time; they would be equally stale by the time
anyone signs, and equally absent from the transaction either way.

This is also why the signing page states plainly that the listed amounts are
an estimate and that what is being approved is "send every listed asset to
this address", not a specific quantity.

It does **not** filter by value. `--min-usd` defaults to `0`, so every chain
holding anything is built. Whether a chain is worth a 2-of-3 hardware ceremony
is an operator judgement, and at 34 chains that decision is worth seeing rather
than inheriting from a constant. The ranked table and the copy-pasteable
`--networks` line make acting on it cheap:

```bash
npx hardhat fees:cycle --min-usd 25                          # apply a floor
npx hardhat fees:cycle --networks base,arbitrum,worldchain   # or pick by hand
```

Useful flags: `--name` (bundle name, default `sweep-<date>`), `--scan-only`,
`--no-eth`, `--concurrency`, `--force`, `--accept-partial`.

Rebuilding an existing bundle name is refused unless `--force`. A rebuild picks
up fresh Safe nonces, which changes every `safeTxHash` and silently kills any
signatures already collected.

Chains that **could not be read** are reported separately from chains with
nothing to collect, and set a non-zero exit code. Previously both simply
vanished from the bundle, which on a 34-chain sweep is indistinguishable from
a silent loss of collectable fees.

### Discovery — how assets are found

The router has no fee accounting, so the only way to know what is collectable
is to read `balanceOf(router)`. The question is *which tokens to ask about*.

A candidate set is assembled per chain from three sources and probed in one
batched **Multicall3** round:

| source | what it is |
|---|---|
| `cdn.oku.trade/tokenlist.json` | Oku's published routing list — ~35,500 addresses across our chains |
| `data/known-fee-assets.json` | committed one-time export of every address log indexing had found (1,496, of which 301 are in no list) |
| chain-config | `tokenList`, `stables`, `token.*`, and the wrapped native |

The whole 34-chain scan costs roughly **180 `eth_call`s and ~24 seconds**.

> **What this replaced.** Discovery used to walk `OrderFilled` history with
> `eth_getLogs`. That made it hostage to whatever block range an endpoint felt
> like serving — a cap that is undiscoverable except by being rejected. On
> 2026-09-29 Alchemy's 10-block cap silently reduced arbitrum to zero
> discovered assets while the router held 34, and reported avax as `$0.00`
> while it held USDC 1,173. There is no longer a logs endpoint, a
> `<NET>_LOGS_URL`, a discovery cache, a request budget, or a coverage verdict.

#### The known limitation

The router accepts **any** ERC-20 as `tokenIn` — the only on-chain allowlist is
of aggregator targets, not tokens — so a candidate set can never be complete.
Measured on base before the pivot, 63 of 300 distinct `tokenIn` addresses (21%)
appeared in no published list.

`data/known-fee-assets.json` carries forward everything indexing had already
found, so the pivot cost nothing that was known at the time. What remains
exposed is a token first traded *after* that export, by direct contract call,
and never listed anywhere.

That gap is deliberately measurable rather than assumed:

```bash
npx hardhat run scripts/dryRunDiscovery.ts
```

It walks real `OrderFilled` history, reports how many held tokens the candidate
set would have missed, and prints them ready to paste into
`data/known-fee-assets.json`. It is an audit tool — nothing in `fees:scan` or
`fees:cycle` depends on it.

#### Failure modes that are reported, not swallowed

- **Multicall3 missing** (xdc deploys it at a non-canonical address, read from
  chain-config) — the scan degrades to well-known tokens only and says so.
- **A batch the node refuses** is split and retried; anything still failing is
  counted as `unchecked`. `fees:cycle` exits non-zero on it, because "we could
  not look" must not read as "there is nothing there".
- **An empty token list** is a hard failure on any path that decides what to
  sweep. It would not error anywhere downstream — it would just find nothing on
  every chain at once.

### Single chain

```bash
# read-only, any single chain
npx hardhat fees:scan --networks worldchain

# build by hand, without a cycle snapshot
npx hardhat safe:build --intent sweep --networks worldchain \
  --name sweep-worldchain

# rehearse against a fork of the real chain, impersonating the Safe
npm run test:fork-sweep
```

`fees:scan --json <path>` writes the same snapshot format `fees:cycle`
produces, so it can be fed straight to `safe:build --from-scan <path>`.

### Valuation

Prices come from **DefiLlama** (`coins.llama.fi`), free and keyless. ERC-20s are
priced by address on their own chain; quotes below 0.9 confidence or older than
24h are rejected rather than used.

The native asset is priced through its wrapped form from
`oku.pricing.nativeWrappedToken`, but only after confirming on chain that the
wrapped token's symbol actually matches the native symbol. That check is not
optional: chain-config's `token.wethAddress` on Polygon is bridged WETH while
the native asset is POL, and conflating them once priced 9.6 POL at $26,447.
`oracles.coingecko.native` is deliberately **not** used — chain-config records
it as `"ethereum"` for celo, whose native asset is CELO, a 27,000x error.

Live coverage is around **88% of held assets**. Assets with no quote are
reported `unpriced` and contribute `$0`, and every total states how many —
because a `$0.00` that means "we could not value this" must not read as "there
is nothing here".

> **There is no liquidity signal.** Valuation used to derive prices from
> Uniswap V3 pool reserves, which also yielded a pool depth and hence a
> `realizable` figure capped by it. That is gone. Deriving prices from reserves
> is what once produced a `$2.1e50` line item from a token quoted against $1.25
> of liquidity, so losing it removes a real class of failure — but nothing now
> distinguishes an asset that can be sold from one that merely quotes a price.
> `--min-usd` gates on notional, so a chain can clear it on paper value.

### Accounting artifacts

`safe:exec` writes the record automatically after a sweep, and
`fees:account --tx <hash>` regenerates it from chain data alone. Layout:

```
fee-reports/
├── data/2026-09-15/worldchain-339173ed.json   machine-readable
├── reports/2026-09-15/worldchain.md           human-readable
├── reports/2026-09-15/SUMMARY.md              cross-chain roll-up for that date
├── ledger.json                                append-only index of every sweep
├── simulations/                               fork rehearsals (gitignored)
└── scans/2026-09-22/17-05-49.{json,md}        pre-sweep snapshots (gitignored)
```

Only what was actually collected is committed. A pre-sweep scan describes money
that merely *exists*, priced off spot pool state, and it is stale the moment the
next swap lands — the same reason fork rehearsals are excluded. The bundle
records which snapshot it was built from in `params.scanRef`.

Human and machine artifacts are separate trees so `data/` can be consumed
programmatically without filtering prose out of it. The date comes from the
**block timestamp**, not the clock, so regenerating a report cannot move it
into the wrong bucket. The JSON filename carries a tx-hash prefix, so a second
sweep of the same chain on the same day cannot overwrite the first — a record
that can be clobbered is not a record.

`ledger.json` and every `SUMMARY.md` are **derived** from `data/`; never edit
them by hand. `fees:report --rebuild` reconstructs both.

Weekly cadence is a filter, not a directory convention — sweeps will not always
land on schedule, and a week-named folder would then either lie or force a
judgement call about which bucket an off-schedule sweep belongs in:

```bash
npx hardhat fees:report                          # everything
npx hardhat fees:report --week 2026-W38          # one ISO week
npx hardhat fees:report --since 2026-07-01 --until 2026-09-30
npx hardhat fees:report --network-name worldchain
npx hardhat fees:report --rebuild                # regenerate ledger + summaries
```

Simulations are diverted to their own gitignored tree. They are rehearsals
describing money that never moved, and letting them sit beside real records
invites someone to read one as an actual collection.

Amounts are derived from two independent sources and cross-checked: the
`TokenWithdrawn`/`EthWithdrawn` events, and the recipient's measured balance
delta. That redundancy is load-bearing — `sweepAll` emits the router's balance
as read *before* the transfer, so a fee-on-transfer or rebasing token delivers
less than the event claims. Any divergence is recorded per-asset as
`deltaMatchesEvent: false` and surfaced in `reconciliation.discrepancies`
rather than being averaged away.

### Forking a chain Hardhat does not know

`hardhat_reset` can change the fork URL but **not** the chainId, and Hardhat
only ships hardfork-activation history for chains it recognises. Set
`FORK_CHAIN_ID` to the real chainId when forking anything else; the config
then reports that chainId and declares the chain post-Cancun, which is what
`npm run test:fork-sweep` relies on. Default behaviour is unchanged.

## License

See [LICENSE](LICENSE) (same terms as okuRouter).
