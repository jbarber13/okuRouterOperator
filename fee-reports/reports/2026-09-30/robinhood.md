# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | robinhood (chainId 4663) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x0ec3f5ada5185e7869470b767f60cee15859f259a58d20d09d79f176d26fdbc4` |
| Block | 76186515 (2026-09-30T03:15:30.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 293348 @ 24662000 wei = 0.000007234548376 |
| Status | success |
| Generated | 2026-09-30T03:15:35.897Z |

## Assets swept (7)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WETH | 0.000046191237269562 | - | - | yes |
| AI | 0.525396919411150408 | - | - | yes |
| PONS | 0.174448515358903005 | - | - | yes |
| USDG | 4.64 | - | - | yes |
| INU | 2.850579410877022222 | - | - | yes |
| NVDA | 0.000309716077961996 | - | - | yes |
| ETH | 0.00656532275081762 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for robinhood; valuations unavailable
