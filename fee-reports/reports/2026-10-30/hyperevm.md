# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-10-30 (2026-W44) |
| Network | hyperevm (chainId 999) |
| Bundle | `sweep-2026-10-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0x37333A9626E99eC2012F3cC47a062649CF741303` |
| Recipient | `0x7C547b4760feC978a26c76FE451BA3F5B00237C6` |
| Tx | `0x472d59af1b793ca4a2bb34756070553fde32b52bd1929c6bbfd5a6a5931629ea` |
| Block | 49940658 (2026-10-30T16:44:46.000Z) |
| Safe nonce | 3 |
| Signers | `0x46e9CF7694535b4Ba5a7ba09f6c54B05CE7A85E3`, `0x5348bb6318f5Dc05C4501BA8D9b543666ec772e8` |
| Gas | 596400 @ 101664500 wei = 0.0000606327078 ($0.01) |
| Status | success |
| Generated | 2026-10-30T16:44:55.009Z |

## Assets swept (8)

| Asset | Amount | USD | Price source | Verified |
|---|---:|---:|---|---|
| NEST | 1056.356231603950989838 | $22.87 | llama-historical@1793377375 | yes |
| WHYPE | 0.0045 | $0.41 | llama-historical@1793378635 | yes |
| SKHYx | 0.0 | $0.00 | llama-historical@1793377375 | **MISMATCH** |
| PURR | 0.593865910078041705 | $0.07 | llama-historical@1793377375 | yes |
| USDC | 5.121058 | $5.12 | llama-historical@1793378635 | yes |
| USD₮0 | 0.302131 | $0.30 | llama-historical@1793378635 | yes |
| AVLT | 1304.272496 | $1425.70 | llama-historical@1793374455 | yes |
| HYPE | 0.194658547338274674 | $17.91 | llama-historical@1793378635 | yes |

**Notional:** $1472.38  

Priced as of the execution block (DefiLlama historical; reviewed aliases; GeckoTerminal current price only when recorded within an hour of execution), so this figure does not move when the report is regenerated. Only firm prices are counted.

## Reconciliation

- Router fully drained: **NO**
- Events match measured balance deltas: **NO**

### Residual balances remaining on the router

- SKHYx: 0.000000000000000001 (`0x58100046a4Afcd4eE4faDbD4244f3f895a341c56`)

### Discrepancies

- SKHYx (0x58100046a4Afcd4eE4faDbD4244f3f895a341c56): event reported 0.000000000000000001 but recipient received 0.0 -- consistent with a fee-on-transfer or rebasing token
