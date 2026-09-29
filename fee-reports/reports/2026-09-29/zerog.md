# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | zerog (chainId 16661) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x0cd6187b435d595053b41f52595079bd162a2a77c4de2119e628a118c7115f61` |
| Block | 45685732 (2026-09-29T19:37:39.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 368064 @ 2000000007 wei = 0.000736128002576448 |
| Status | success |
| Generated | 2026-09-29T19:37:41.522Z |

## Assets swept (6)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WBTC | 0.00001841 | - | - | yes |
| USDC.e | 15.777126 | - | - | yes |
| a0G | 0.868754744991474518 | - | - | yes |
| LINK | 0.1 | - | - | yes |
| cbBTC | 0.0000312 | - | - | yes |
| 0G | 15.569621726544640316 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for zerog; valuations unavailable
