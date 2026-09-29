# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | avax (chainId 43114) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x9c3ae17688809f0249ff13b27fd52c9c64069cca19e7bce38924f5fd8458c901` |
| Block | 96409706 (2026-09-29T19:38:15.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 156117 @ 5000000150 wei = 0.00078058502341755 |
| Status | success |
| Generated | 2026-09-29T19:38:17.485Z |

## Assets swept (2)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDt | 7.708733 | - | - | yes |
| AVAX | 3.049416024422844154 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for avax; valuations unavailable
