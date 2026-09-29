# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | linea (chainId 59144) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x55dc80f915dbe16081e63bbc5ddde430005d0c888c36f9182083ae5bb543a8af` |
| Block | 32184494 (2026-09-29T19:38:19.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 148543 @ 68362838 wei = 0.000010154821045034 ($0.03) |
| Status | success |
| Generated | 2026-09-29T19:38:27.028Z |

## Assets swept (2)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDT | 0.658084 | $0.66 | $0.66 | yes |
| ETH | 0.000385345042898701 | $1.03 | $1.03 | yes |

**Notional:** $1.69  
**Realizable:** $1.69

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
