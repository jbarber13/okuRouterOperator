# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | gnosis (chainId 100) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x769d5aa0bc0ff2b8989d224563333d6f7b36d2d1038df4c949d2bd80ed8cdc47` |
| Block | 48504292 (2026-09-29T19:32:30.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 558452 @ 11 wei = 0.000000000006142972 |
| Status | success |
| Generated | 2026-09-29T19:32:47.129Z |

## Assets swept (12)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDC.e | 1.64 | - | - | yes |
| PNK | 12.0 | - | - | yes |
| EURe | 34.49012 | - | - | yes |
| WETH | 0.002888 | - | - | yes |
| GBPe | 22.0 | - | - | yes |
| WBTC | 0.00063053 | - | - | yes |
| GNO | 0.048600813713045834 | - | - | yes |
| ZCHF | 0.7 | - | - | yes |
| USDC | 1.053338 | - | - | yes |
| sDAI | 1.3275 | - | - | yes |
| OLAS | 0.105865518772194896 | - | - | yes |
| XDAI | 8.469546310317443206 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- could not read USDC decimals; assuming 6
- gnosis: no WETH/USDC pool with usable liquidity; native and WETH-quoted assets are unpriced
