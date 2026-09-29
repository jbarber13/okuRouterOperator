# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | rootstock (chainId 30) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x0906896E8564c61F40778E2B7A46E1269Aaa681e` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x126185684389d853036738899d4e50fcb28e63aba9324f89dedbbb8f4dfa364a` |
| Block | 9282663 (2026-09-29T19:29:12.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 136024 @ 26065600 wei = 0.0000035455471744 |
| Status | success |
| Generated | 2026-09-29T19:29:46.824Z |

## Assets swept (3)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDRIF | 9.70673891932927985 | $9.71 | $9.71 | yes |
| WRBTC | 0.00000484763652699 | - | - | yes |
| RBTC | 0.001608494717210819 | - | - | yes |

**Notional:** $9.71  
**Realizable:** $9.71

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- rootstock: no WETH/USDC pool with usable liquidity; native and WETH-quoted assets are unpriced
