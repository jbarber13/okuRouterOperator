# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | unichain (chainId 130) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xd6c1a170765c1d39fada8510ce7a1a5e8e296f5a1c7112696017d4b96580f40f` |
| Block | 59962024 (2026-09-29T19:33:03.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 140682 @ 1500000 wei = 0.000000211023 |
| Status | success |
| Generated | 2026-09-29T19:33:06.649Z |

## Assets swept (2)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WETH | 0.000028950317675382 | - | - | yes |
| ETH | 0.000573271130577506 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for unichain; valuations unavailable
