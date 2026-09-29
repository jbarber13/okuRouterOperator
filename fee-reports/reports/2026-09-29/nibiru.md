# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | nibiru (chainId 6900) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x7B060A98BA242Ae42D6027a60937787eBe33DEBe` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x498c66dcb6f961b13ca97fae307953bca71cb88b91db2f24512764fcb2ae8c40` |
| Block | 47020650 (2026-09-29T19:37:05.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 152198 @ 0 wei = 0.0 |
| Status | success |
| Generated | 2026-09-29T19:37:08.713Z |

## Assets swept (2)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDC.e | 0.499819 | $0.50 | $0.50 | yes |
| NIBI | 5472.05712069402992423 | - | - | yes |

**Notional:** $0.50  
**Realizable:** $0.50

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- nibiru: no WETH/USDC pool with usable liquidity; native and WETH-quoted assets are unpriced
