# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | redbelly (chainId 151) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x44a81236E892faEdc1f7c08362a4A0eC90dDd203` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xe943ad074fd1e0a804957b9147620623439b5a44cb98a6a6bf0c80eafad782a9` |
| Block | 3207494 (2026-09-29T19:34:01.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 156998 @ 195160031225604 wei = 30.639734582357376792 ($0.08) |
| Status | success |
| Generated | 2026-09-29T19:34:08.114Z |

## Assets swept (2)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDC.e | 1.05 | $1.05 | $1.05 | yes |
| RBNT | 4069.217509798310355262 | $10.17 | $10.17 | yes |

**Notional:** $11.22  
**Realizable:** $11.22

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
