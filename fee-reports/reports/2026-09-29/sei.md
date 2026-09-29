# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | sei (chainId 1329) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x7B060A98BA242Ae42D6027a60937787eBe33DEBe` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x8ce6e10417209e437e862c357ac65029fa9ae8f1d65d72c717916983983c1456` |
| Block | 234835808 (2026-09-29T19:35:54.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 570381 @ 51000000000 wei = 0.029089431 ($0.01) |
| Status | success |
| Generated | 2026-09-29T19:36:07.194Z |

## Assets swept (6)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WSEI | 78.556943799104443394 | $16.10 | $16.10 | yes |
| WETH | 0.000144070539494233 | $1.07 | $1.07 | yes |
| USDC | 0.002 | $0.01 | $0.01 | yes |
| PYUSD0 | 0.023362 | - | - | yes |
| frxUSD | 0.750841146668385122 | - | - | yes |
| SEI | 73.70001 | $15.10 | $15.10 | yes |

**Notional:** $32.27  
**Realizable:** $32.27

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
