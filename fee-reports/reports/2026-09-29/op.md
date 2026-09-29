# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | op (chainId 10) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xb1065b5e0770549a8e1a126c82378b481fda43e92b7bc6c0636ed00e4388fbec` |
| Block | 157555664 (2026-09-29T19:28:25.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 248548 @ 1000397 wei = 0.000000248646673556 ($0.00) |
| Status | success |
| Generated | 2026-09-29T19:28:30.080Z |

## Assets swept (5)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WBTC | 0.00026011 | $21.68 | $21.68 | yes |
| USDC | 6.270258 | $6.27 | $6.27 | yes |
| WETH | 0.001737863202885553 | $4.68 | $4.68 | yes |
| STG | 0.365292887831838716 | $0.05 | $0.05 | yes |
| ETH | 0.001015480724597786 | $2.73 | $2.73 | yes |

**Notional:** $35.41  
**Realizable:** $35.41

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
