# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | hyperevm (chainId 999) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xcb26e58962f7b5d74204f1ee6105ce60f136d7581469ddfaaf9a9f99d9e108cd` |
| Block | 47228256 (2026-09-29T19:35:45.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 267195 @ 317496586 wei = 0.00008483350029627 |
| Status | success |
| Generated | 2026-09-29T19:35:51.231Z |

## Assets swept (5)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| UBTC | 0.00001014 | - | - | yes |
| USD₮0 | 0.25868 | - | - | yes |
| USDC | 31.814395 | - | - | yes |
| WHYPE | 2.726792594273283002 | - | - | yes |
| HYPE | 0.201011844012423458 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for hyperevm; valuations unavailable
