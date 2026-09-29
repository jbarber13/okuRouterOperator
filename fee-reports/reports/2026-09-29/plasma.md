# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | plasma (chainId 9745) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xe62e736c0549c0db456eecf3e8b99bf1a07e774c2b0a5fac4bdb08ae2019c1d0` |
| Block | 33769691 (2026-09-29T19:37:31.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 526624 @ 2118 wei = 0.000000001115389632 |
| Status | success |
| Generated | 2026-09-29T19:37:35.504Z |

## Assets swept (11)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| sUSDai | 47.451819908475462014 | - | - | yes |
| sUSDe | 0.11565 | - | - | yes |
| USDC | 0.260822 | - | - | yes |
| WXPL | 1304.479242568614607842 | - | - | yes |
| yzUSD | 0.893949078242552359 | - | - | yes |
| trillions | 2170.26 | - | - | yes |
| WETH | 0.000207655564 | - | - | yes |
| USDT0 | 28.230128 | - | - | yes |
| GOOSE | 46937.557777186924406982 | - | - | yes |
| GHO | 4.747795169367252179 | - | - | yes |
| XPL | 352.772580667542492874 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for plasma; valuations unavailable
