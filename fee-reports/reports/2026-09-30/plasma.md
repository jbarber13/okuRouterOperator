# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | plasma (chainId 9745) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xd2cbb868775fe7c97f5edaaf4fe48ba8eddb735be9796ce71812099ecf8700aa` |
| Block | 33797295 (2026-09-30T03:17:40.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 153688 @ 1811891 wei = 0.000000278465904008 |
| Status | success |
| Generated | 2026-09-30T03:17:42.536Z |

## Assets swept (3)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| sUSDai | 0.094903639816950924 | - | - | yes |
| WXPL | 2.608958485137229215 | - | - | yes |
| XPL | 0.7 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for plasma; valuations unavailable
