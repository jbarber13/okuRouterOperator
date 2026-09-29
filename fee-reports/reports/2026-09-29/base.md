# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | base (chainId 8453) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x090e726d151c23a21c21470e296a92de3e73aa3ed7bcad58e36447aee8bf3750` |
| Block | 51960643 (2026-09-29T19:37:13.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 570560 @ 6000000 wei = 0.00000342336 ($0.01) |
| Status | success |
| Generated | 2026-09-29T19:37:28.179Z |

## Assets swept (13)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| TIBBIR | 1081.63826239430260268 | $447.83 | $447.83 | yes |
| USDC | 366.793282 | $366.79 | $366.79 | yes |
| WETH | 0.021073395658257641 | $56.71 | $56.71 | yes |
| AERO | 18.323622528806497221 | $14.85 | $14.85 | yes |
| cbBTC | 0.00014945 | $12.47 | $12.47 | yes |
| USDbC | 4.551903 | $4.54 | $4.54 | yes |
| AAVE | 0.018717827252066036 | $3.09 | $3.09 | yes |
| EURC | 2.716502 | $3.08 | $3.08 | yes |
| UMIA | 0.317871849018142152 | $0.21 | $0.21 | yes |
| ENA | 32.193607217968356743 | - | - | yes |
| wtFGI | 0.033112986160371679 | - | - | yes |
| aeon | 10074.409835973851198624 | - | - | yes |
| ETH | 0.033021743785842002 | $88.86 | $88.86 | yes |

**Notional:** $998.42  
**Realizable:** $998.42

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
