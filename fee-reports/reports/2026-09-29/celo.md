# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | celo (chainId 42220) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x60848c358e2362e90fc0c95acfb5a3591584067fe8da82330c77605d89194ce5` |
| Block | 78809912 (unknown) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 599051 @ 202500000000 wei = 0.1213078275 |
| Status | success |
| Generated | 2026-09-29T19:37:56.192Z |

## Assets swept (7)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| CELO | 2.721339855232705571 | - | - | event only |
| USD₮ | 2.171912 | - | - | yes |
| USDGLO | 0.631341983622400197 | - | - | yes |
| G$ | 517363.462963984309513109 | - | - | yes |
| USDm | 4.420465831147574508 | - | - | yes |
| EURA | 0.5835051305 | - | - | yes |
| UNI | 0.163 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for celo; valuations unavailable
