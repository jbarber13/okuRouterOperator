# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | pharos (chainId 1672) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x764c87a1f5ee1b016c3ad236ff5676586becb0adc41634c3e40dd796c50eb4bb` |
| Block | 18932259 (2026-09-29T19:36:11.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 140768 @ 10000000000 wei = 0.00140768 |
| Status | success |
| Generated | 2026-09-29T19:36:18.143Z |

## Assets swept (2)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WPROS | 0.994902260509266514 | - | - | yes |
| PROS | 0.06 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for pharos; valuations unavailable
