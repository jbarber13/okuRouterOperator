# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | bob (chainId 60808) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x3132f599bde0e251ba12d5FF95E256FbBeCbDA83` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x91de649eaba738ddd0de9bf1f60853caf90d24b90270e3f61dc26a7e72bf10aa` |
| Block | 38924361 (2026-09-29T19:38:29.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 453682 @ 1000252 wei = 0.000000453796327864 |
| Status | success |
| Generated | 2026-09-29T19:38:35.861Z |

## Assets swept (10)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WBTC | 0.00001876 | - | - | yes |
| WBTC | 0.00000148 | - | - | yes |
| USDT | 1.798972 | - | - | yes |
| WETH | 0.000096388888459483 | - | - | yes |
| SolvBTC | 0.000003099003076305 | - | - | yes |
| satUSD | 0.248066302304768931 | - | - | yes |
| rETH | 0.00007413737128482 | - | - | yes |
| xSolvBTC | 0.000020526715325306 | - | - | yes |
| USDC.e | 0.498564 | - | - | yes |
| ETH | 0.007570703516340093 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for bob; valuations unavailable
