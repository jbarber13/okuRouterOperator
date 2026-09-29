# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | saga (chainId 5464) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x2D8261402d4777975AE43877A189b0Ab6b526e26` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x499596b365911308e96b044362db3fab9b479deababa33e016441118997bbea8` |
| Block | 10153206 (2026-09-29T19:36:50.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 228810 @ 0 wei = 0.0 ($0.00) |
| Status | success |
| Generated | 2026-09-29T19:37:01.397Z |

## Assets swept (6)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDC | 21.938442 | $21.94 | $21.94 | yes |
| SAGA | 93.8205 | $2.46 | $2.46 | yes |
| WETH | 0.000544806750659218 | $1.40 | $1.40 | yes |
| USDT | 0.499005 | $0.50 | $0.50 | yes |
| D | 1.239172243917065214 | $0.34 | $0.34 | yes |
| CLSTR | 52341.663241 | - | - | yes |

**Notional:** $26.63  
**Realizable:** $26.63

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
