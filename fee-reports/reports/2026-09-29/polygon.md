# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | polygon (chainId 137) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x47501fb878865cebc2d9617028a6eef2f8cbd1286af24bfee9a9220305fb1b21` |
| Block | 94670177 (2026-09-29T19:33:26.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 1553200 @ 275184362610 wei = 0.427416352005852 |
| Status | success |
| Generated | 2026-09-29T19:33:49.840Z |

## Assets swept (24)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WETH | 0.022695139863178291 | $61.16 | $61.16 | yes |
| USDT0 | 33.497884 | $33.49 | $33.49 | yes |
| USDC | 24.223333 | $24.22 | $24.22 | yes |
| GEOD | 37.61515525825062404 | $9.95 | $9.95 | yes |
| USDR | 5.362980768 | $2.28 | $1.01 | yes |
| USDC | 1.60194 | $1.60 | $1.60 | yes |
| JPYC | 49.981869152858626472 | $0.45 | $0.45 | yes |
| WBTC | 0.00000408 | $0.34 | $0.34 | yes |
| AAVE | 0.001826701981377725 | $0.30 | $0.30 | yes |
| KIT | 0.9425 | $0.25 | $0.25 | yes |
| LINK | 0.009 | $0.13 | $0.13 | yes |
| STG | 0.92830740698 | $0.12 | $0.12 | yes |
| DAI | 0.023047337146527887 | $0.02 | $0.02 | yes |
| CRETA | 4.84694 | - | - | yes |
| PYR | 1.95066 | - | - | yes |
| BRZ | 1.552986646637011187 | - | - | yes |
| aPolUSDT | 8.947867 | - | - | yes |
| aPolWMATIC | 1.888913319017185546 | - | - | yes |
| JPYC | 14375.0 | - | - | yes |
| FUSD | 0.242573428796886913 | - | - | yes |
| DTEC | 2.54698879272 | - | - | yes |
| TEL | 44.31 | - | - | yes |
| SYN | 0.09879627350742135 | - | - | yes |
| POL | 12.297916902173403609 | - | - | yes |

**Notional:** $134.34  
**Realizable:** $133.06

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- polygon: the configured WETH is not the wrapped form of POL, so the native balance is left unpriced rather than valued as ether.
