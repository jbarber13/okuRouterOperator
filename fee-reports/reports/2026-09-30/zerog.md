# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | zerog (chainId 16661) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xe6f75d009ee7d0f1ed814d3a3477394684466442f5ac6d4d8da4ae433352f188` |
| Block | 45716491 (2026-09-30T03:17:47.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 133996 @ 4000000007 wei = 0.000535984000937972 |
| Status | success |
| Generated | 2026-09-30T03:17:52.926Z |

## Assets swept (1)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| a0G | 0.001737509489982949 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for zerog; valuations unavailable
