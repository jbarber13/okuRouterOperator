# Signer instructions — Oku Router multisig

You are one of three hardware-wallet signers on the Oku multisig
`0x37333A9626E99eC2012F3cC47a062649CF741303` (2-of-3).

- **Cost to you:** nothing. You produce signatures only — no transactions from
  your wallet, no gas on any chain.
- **Time:** a few minutes, mostly confirming prompts on your device.
- Nothing here will ever ask for your seed phrase.

> **Read the next section before signing anything.** Different bundles
> authorize very different things. Some are administrative and cannot move
> money; at least one type moves every token on a chain.

---

## What am I being asked to approve?

The page shows the bundle's **intent** as a pill at the top. Find it here
before you sign. If the intent is not on this list, or does not match what the
coordinator told you, **stop and ask**.

| Intent | What it does | Can it move funds? |
| --- | --- | --- |
| `accept-ownership` | Multisig becomes owner of that chain's router | No |
| `swap-targets` | Whitelists a DEX aggregator address | No |
| `valid-signer` | Adds/removes a backend quote signer | No |
| `pause` / `unpause` | Halts or resumes swaps | No |
| `max-warrant-duration` | Changes a quote-expiry limit | No |
| **`sweep`** | **Transfers the router's entire token and ETH balance to a named address** | **YES — irreversibly** |

### If the intent is `sweep`

The page shows a red **"This transaction moves funds"** panel listing the
recipient address and every asset being transferred. That panel is the thing
to check. Specifically:

1. **Confirm the recipient address** against the address the coordinator gave
   you through a *different* channel than the one that sent you the bundle.
   Compare the whole string, not the first and last four characters. A sweep
   cannot be reversed or recalled.
2. **Confirm the asset list looks plausible** for accumulated fees. It is
   normal to see a long tail of obscure tokens worth very little, and to see
   some with no USD value at all; those are leftovers from swaps that routed
   through the router. What matters is the list of assets and the recipient —
   not the quantities.

   The **amounts shown are an estimate** taken when the bundle was built and
   are *not* part of what you sign. The transaction names a token list only;
   it moves whatever balance is on the router at the moment it executes.
   Treat the numbers as an indication of scale, never as a cap.
3. **If the panel warns that there is more than one recipient, do not sign.**
   A normal sweep has exactly one.

Two signatures on a sweep bundle are sufficient to move the funds. Treat your
signature as the authorization it is — there is no further approval step after
the threshold is met.

---

## Requirements

- Node.js 20+ (`node --version`)
- Chrome/Brave/Edge with **MetaMask**, and your Trezor/Ledger connected
  through it
- A clone of this repo, up to date on the default branch

---

## Steps

**1. Get the repo up to date and install**

```bash
git pull oku master
npm install
```

**2. Start the server and leave it running**

```bash
npm run sign-page
```

That is the whole setup. The server works out which bundles still need your
signature, builds the page for them, and removes any page that is already
finished — so whatever link it prints is exactly the work outstanding.

You do **not** need RPC endpoints, API keys, a `.env` file, or to run any
scanning task. The coordinator has already worked out which chains hold fees;
chains with nothing on them are not in the bundle and will never appear on
your page. Everything the page needs is embedded in it.

It prints something like:

```
Open:

  http://127.0.0.1:8547/sweep-worldchain/sign.html
      1 chain(s), 0 signature(s) collected, 0/1 ready to execute
```

Open that link in Chrome. **Keep this terminal open** — the server is what
writes your signatures to disk as you go.

> Use the printed `http://127.0.0.1` URL. Do not open `sign.html` directly as
> a `file://` path — MetaMask does not inject a provider there.

If it says *"Nothing to sign"*, everything is already signed, or you need to
`git pull` again to pick up a new bundle.

**3. Check the intent**

Look at the pill at the top of the page and find it in the table above. If it
is `sweep`, work through the sweep checklist before going further.

**4. Connect your wallet**

Unlock your device, click **Connect wallet**, and select your signer account.

The badge must read **✓ Safe owner**. If it reads **✗ NOT a Safe owner**,
you've selected the wrong account in MetaMask — switch and reconnect.

**5. Sign**

Click **Sign all remaining**, then for each chain:

- Approve the MetaMask **switch network** / **add network** prompt. This is
  required — a signature is only valid for the correct chain, and several of
  these networks are unusual.
- Confirm on your hardware wallet.

The status line should stay green:

```
✓ autosaved to disk — 12 signature(s) in safe-bundles/<bundle>/signatures-0x….json
```

If it ever turns red (**NOT saved to disk**), stop and tell the coordinator
before closing the tab.

**6. Send your signatures back**

```
safe-bundles/<bundle>/signatures-0xYOURADDRESS.json
```

Send that one file to the coordinator over any normal channel. It is not a
secret and is useless alone — two of three signers are required. Then `Ctrl+C`
the server.

---

## Verifying on the device

Every chain row has a **"review what your device will show"** card. The page
computes it from the exact payload it hands your wallet (it does not trust the
bundle's descriptions), and it **will not send a payload to your wallet** if
anything about it fails its checks — that row turns red and its sign button is
disabled. Open the card before confirming on the device and compare:

**If your device shows the fields one by one** (Trezor; Ledger with clear
signing):

1. Domain: **chainId** and **verifyingContract** =
   `0x37333A9626E99eC2012F3cC47a062649CF741303` (the multisig).
2. Message, in this order: **to** (for a sweep: the router, named on the card),
   **value** `0`, **data**, **operation** `0`, **safeTxGas / baseGas /
   gasPrice** `0`, **gasToken / refundReceiver** `0x0000…0000`, **nonce**.
3. For a sweep, `data` contains the recipient — the card's section 3 shows it
   decoded, along with every token address. The recipient must match the
   address you were given out of band.

**If your Ledger shows only "Domain hash" and "Message hash"** (blind
signing): compare both against section 4 of the card. The Ethereum app must
have *Blind signing* enabled in its settings for this to work at all.

Your device may say **"unknown network"** on unusual chains. That's expected;
the chainId and verifyingContract above are the real check, not the name.

Every chain in a sweep bundle describes the same action: `sweepAll` to the
router, one call, operation `0`. The amounts in the dashed **"Not signed"**
box are estimates and are not part of what you approve.

> **Recording what your device shows.** The coordinator may ask you to run a
> one-off device test: `FORK_CHAIN_ID=31337 npx hardhat node` in one terminal,
> `npx hardhat safe:device-test` then `npm run sign-page` in another, and sign
> the three rows at `http://127.0.0.1:8547/device-test/sign.html`, filling in
> `safe-bundles/device-test/WORKSHEET.md`. Those payloads are for chainId
> 31337 only and cannot execute on any real chain.

## Sign off-chain, not on-chain

If you also use app.safe.global, note it sometimes offers to "approve" a
transaction via an on-chain `approveHash` transaction. **Don't** — that costs
you gas on every chain, and some signers hold no balance on many chains. This
page only ever produces off-chain signatures, so using it avoids the issue
entirely.

## Stopping and resuming

Close the tab whenever you like. Everything signed so far is already on disk.
To continue, repeat step 2; already-signed chains are skipped.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `no injected wallet found` | Check the diagnostics box on the page. Usually a `file://` URL, a locked extension, or the site not in MetaMask → Connected sites. Hard-reload after unlocking. |
| Multiple wallets installed | The page lists them (EIP-6963); pick the one your device sits behind. |
| `✗ NOT a Safe owner` | Wrong MetaMask account selected. |
| `Nothing to sign` | Everything is already signed, or you need `git pull oku master` to pick up a new bundle. |
| `Port 8547 is already in use` | A stale server is running. Stop it, or use `PORT=8548 npm run sign-page`. |
| A signature is rejected | Reason appears in the page log. Usually the wrong account, or a stale bundle — `git pull oku master` and restart the server. |
| Signatures stop being accepted | The multisig executed something else and nonces moved. The coordinator will rebuild; your old signatures are void. |

Nothing you do here changes any blockchain state by itself. No change occurs
until two signatures are combined and submitted by the coordinator — but once
that happens, for a `sweep` bundle, the funds are gone.
