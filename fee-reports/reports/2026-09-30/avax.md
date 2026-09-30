# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | avax (chainId 43114) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xca0c966c7627468c61a169d522afc05d04a04c6be71198b20dcaf4f3a98e6dc3` |
| Block | 96430229 (2026-09-30T03:18:33.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 625088 @ 5085740209 wei = 0.003179035175763392 |
| Status | success |
| Generated | 2026-09-30T03:18:37.866Z |

## Assets swept (15)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| AUSD | 0.004844 | - | - | yes |
| WBTC | 0.00000816 | - | - | yes |
| BTC.b | 0.00000673 | - | - | yes |
| SYN | 1.489020529656176588 | - | - | yes |
| sUSDe | 0.1395 | - | - | yes |
| STG | 1.8412944 | - | - | yes |
| WETH.e | 0.0001 | - | - | yes |
| AAPL | 0.001184 | - | - | yes |
| USDt | 0.014 | - | - | yes |
| PEPE | 75.315262745169201476 | - | - | yes |
| USDC | 1173.226342 | - | - | yes |
| DOMI | 2264.045493181932095217 | - | - | yes |
| BLACK | 122.70783917114909378 | - | - | yes |
| DAI.e | 0.013467000169397359 | - | - | yes |
| AVAX | 0.00607 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for avax; valuations unavailable
