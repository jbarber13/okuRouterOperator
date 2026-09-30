# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | polygon (chainId 137) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xd19207cef387066bd05a3cf472e3f1ae0e1d16fbef297b4b48e63ed4da356a0e` |
| Block | 94688622 (2026-09-30T03:14:33.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 489643 @ 255012543789 wei = 0.124865106978477327 |
| Status | success |
| Generated | 2026-09-30T03:14:38.773Z |

## Assets swept (6)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WETH | 0.000045390279726356 | $0.12 | $0.12 | yes |
| USDT0 | 0.095975 | $0.10 | $0.10 | yes |
| GEOD | 0.075230310516501248 | $0.02 | $0.02 | yes |
| USDR | 0.010725961 | $0.00 | $0.00 | yes |
| aPolUSDT | 0.017895 | - | - | yes |
| oETH | 0.000519682 | - | - | yes |

**Notional:** $0.24  
**Realizable:** $0.24

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
