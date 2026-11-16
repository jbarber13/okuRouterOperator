# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-10-30 (2026-W44) |
| Network | arbitrum (chainId 42161) |
| Bundle | `sweep-2026-10-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0x37333A9626E99eC2012F3cC47a062649CF741303` |
| Recipient | `0x7C547b4760feC978a26c76FE451BA3F5B00237C6` |
| Tx | `0x3236de6a688f5c03d639baf179f45350c410c64ea614a5c786e01537f596f830` |
| Block | 519735646 (2026-10-30T16:46:29.000Z) |
| Safe nonce | 2 |
| Signers | `0x46e9CF7694535b4Ba5a7ba09f6c54B05CE7A85E3`, `0x5348bb6318f5Dc05C4501BA8D9b543666ec772e8` |
| Gas | 2596646 @ 20366000 wei = 0.000052883292436 ($0.12) |
| Status | success |
| Generated | 2026-10-30T16:46:32.953Z |

## Assets swept (33)

| Asset | Amount | USD | Price source | Verified |
|---|---:|---:|---|---|
| SYN | 1.757776594066585591 | $0.27 | llama-historical@1793378510 | yes |
| AIDOGE | 161577523035.8995 | $1.17 | llama-historical@1793377375 | yes |
| sUSDai | 0.083289099597024656 | $0.09 | llama-historical@1793377375 | yes |
| CHIP | 28.794600547222587376 | $1.28 | llama-historical@1793378510 | yes |
| UMAMI | 0.360100393 | ~$0.00 thin | gecko-current:$2k | yes |
| alETH | 0.000002774184406489 | $0.01 | llama-historical@1793377375 | yes |
| frxETH | 0.000006669941030865 | $0.01 | llama-historical@1793377375 | yes |
| DOC | 0.157080945532 | $0.16 | llama-historical@1793377375 | yes |
| WBTC | 0.00017584 | $13.61 | llama-historical@1793378510 | yes |
| PEAR | 1.68 | $0.04 | llama-historical@1793377375 | yes |
| COMP | 0.003810658 | $0.08 | llama-historical@1793378510 | yes |
| GRAIL | 0.000217798682654865 | $0.01 | llama-historical@1793376475 | yes |
| HEGIC | 16.658761131145398418 | $0.23 | llama-historical@1793365703 | yes |
| RBTC | 0.000467260741674489 | $36.23 | llama-historical@1793377375 | yes |
| PYUSD | 1.050492 | $1.05 | llama-historical@1793378758 | yes |
| ZRO | 0.010298585029901564 | $0.02 | llama-historical@1793378758 | yes |
| ETHFI | 0.542 | $0.32 | llama-historical@1793378510 | yes |
| GHO | 4.866188902364706783 | $4.86 | llama-historical@1793378510 | yes |
| WETH | 0.000224952193162764 | $0.50 | llama-historical@1793378758 | yes |
| ARB | 47.364695186709677521 | $7.70 | llama-historical@1793378758 | yes |
| AAPLx | 0.017707957555957638 | $6.17 | llama-historical@1793377375 | **MISMATCH** |
| GNO | 0.002082861716709269 | $0.22 | llama-historical@1793377375 | yes |
| rAAPL | 0.000074695698195 | $0.03 | llama-historical@1793377375 | yes |
| USDC | 288.867313 | $288.81 | llama-historical@1793378758 | yes |
| AAVE | 0.002225651404503156 | $0.28 | llama-historical@1793378758 | yes |
| VTIx | 0.0 | $0.00 | llama-historical@1793377375 | **MISMATCH** |
| NVDAx | 0.005516655467388298 | $1.13 | llama-historical@1793377375 | **MISMATCH** |
| DAI | 2.197272919193889579 | $2.20 | llama-historical@1793377375 | yes |
| KNC | 0.128270536641566521 | $0.02 | gecko-current:$51k | yes |
| LINK | 0.217309621418137053 | $2.43 | llama-historical@1793378758 | yes |
| USD₮0 | 17.34691 | $17.33 | llama-historical@1793378758 | yes |
| USDC | 1.315308 | $1.31 | llama-historical@1793377375 | yes |
| ETH | 0.267517014795187008 | $597.84 | llama-historical@1793378758 | yes |

**Notional:** $985.41  
**Thin, not counted:** $0.00 across 1 asset(s)  

Priced as of the execution block (DefiLlama historical; reviewed aliases; GeckoTerminal current price only when recorded within an hour of execution), so this figure does not move when the report is regenerated. Only firm prices are counted.

## Reconciliation

- Router fully drained: **NO**
- Events match measured balance deltas: **NO**

### Residual balances remaining on the router

- AAPLx: 0.000000000000000001 (`0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a`)
- VTIx: 0.000000000000000001 (`0xbD730E618bcD88C82dDeE52e10275CF2f88A4777`)
- NVDAx: 0.000000000000000001 (`0xc845b2894dBddd03858fd2D643B4eF725fE0849d`)

### Discrepancies

- AAPLx (0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a): event reported 0.017707957555957639 but recipient received 0.017707957555957638 -- consistent with a fee-on-transfer or rebasing token
- VTIx (0xbD730E618bcD88C82dDeE52e10275CF2f88A4777): event reported 0.000000000000000001 but recipient received 0.0 -- consistent with a fee-on-transfer or rebasing token
- NVDAx (0xc845b2894dBddd03858fd2D643B4eF725fE0849d): event reported 0.005516655467388299 but recipient received 0.005516655467388298 -- consistent with a fee-on-transfer or rebasing token

### Warnings

- arbitrum: 1 thin price(s) shown but not counted, 0 asset(s) unpriced
