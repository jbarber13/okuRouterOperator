# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | arbitrum (chainId 42161) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xc5f011361e5a386bba5fd6ee273bd473c6b03a11885651d7a5b09635bfca8f19` |
| Block | 510125958 (2026-09-29T19:37:44.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 248677 @ 20006000 wei = 0.000004975032062 ($0.01) |
| Status | success |
| Generated | 2026-09-29T19:37:48.042Z |

## Assets swept (4)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WBTC | 0.00018689 | $15.62 | $15.62 | yes |
| WETH | 0.001968895387816094 | $5.31 | $5.31 | yes |
| USDC | 0.410029 | $0.41 | $0.41 | yes |
| ETH | 0.466948747462343085 | $1258.53 | $1258.53 | yes |

**Notional:** $1279.87  
**Realizable:** $1279.87

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
