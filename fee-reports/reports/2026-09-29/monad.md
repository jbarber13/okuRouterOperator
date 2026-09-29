# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | monad (chainId 143) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xedda77ec9e4699ced707ee4c49646efde05d03fe4f9344414d7ab5e19330895a` |
| Block | 109120577 (2026-09-29T19:33:51.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 665082 @ 102000000000 wei = 0.067838364 ($0.00) |
| Status | success |
| Generated | 2026-09-29T19:33:56.984Z |

## Assets swept (5)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDC | 17.189748 | $17.19 | $17.19 | yes |
| WBTC | 0.00005889 | $4.91 | $4.91 | yes |
| WMON | 125.352593838714937054 | $3.48 | $3.48 | yes |
| XAUt0 | 0.0005 | - | - | yes |
| MON | 3571.873683323583372676 | $99.16 | $99.16 | yes |

**Notional:** $124.73  
**Realizable:** $124.73

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
