# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | worldchain (chainId 480) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xd0048dbcb03ca4ec99a648dd6e9cf3013e8148ade70383e920c2746f42c88952` |
| Block | 35701225 (2026-09-30T03:14:49.000Z) |
| Safe nonce | 3 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 355549 @ 1500000 wei = 0.0000005333235 ($0.00) |
| Status | success |
| Generated | 2026-09-30T03:15:02.603Z |

## Assets swept (10)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WLD | 0.632160313259487448 | $0.31 | $0.31 | yes |
| EURC | 0.024565 | $0.03 | $0.03 | yes |
| WDD | 178.044156106126125157 | $0.01 | $0.01 | yes |
| ORO | 0.076600000002089569 | $0.00 | $0.00 | yes |
| SUSHI | 0.0269 | $0.00 | $0.00 | yes |
| GOLD | 4.755085905223139393 | - | - | yes |
| wARS | 200.0167 | - | - | yes |
| USD₮0 | 0.000305 | - | - | yes |
| Pi | 4732.275954400036019523 | - | - | yes |
| ETH | 0.000016 | $0.04 | $0.04 | yes |

**Notional:** $0.39  
**Realizable:** $0.39

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
