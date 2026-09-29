# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | mantle (chainId 5000) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x86d61277970685075a0BF66023c219dc4A6e3F6d` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x9957412df505b9f99158ef55606832aa803d9888c11fba01be2ae7a393c163ec` |
| Block | 101290150 (2026-09-29T19:36:52.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 187746 @ 50000100000 wei = 0.0093873187746 ($0.01) |
| Status | success |
| Generated | 2026-09-29T19:36:52.585Z |

## Assets swept (3)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDC | 10.612822 | $10.61 | $10.61 | yes |
| WMNT | 12.91653488735998683 | $8.54 | $8.54 | yes |
| MNT | 156.996488036042985968 | $103.80 | $103.80 | yes |

**Notional:** $122.95  
**Realizable:** $122.95

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
