# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | xdc (chainId 50) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x7B060A98BA242Ae42D6027a60937787eBe33DEBe` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xdfb5d0a4031349d40337dfec2f81a1147d380de4e1838836bc60ecfe2a7c07e8` |
| Block | 107815226 (2026-09-29T19:29:58.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 413606 @ 25000000000 wei = 0.01034015 ($0.00) |
| Status | success |
| Generated | 2026-09-29T19:30:18.492Z |

## Assets swept (8)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| CGO | 0.0092 | $1.19 | $1.19 | yes |
| USDC | 0.512355 | $0.51 | $0.51 | yes |
| XSP | 10105.156007631660809015 | - | - | yes |
| SRX | 122.72681304109589041 | - | - | yes |
| xUSDT | 3.992 | - | - | yes |
| G$ | 1882.77118912223845466 | - | - | yes |
| PLI | 4462.874842176092986023 | - | - | yes |
| XDC | 3695.762290221696000738 | $124.22 | $124.22 | yes |

**Notional:** $125.92  
**Realizable:** $125.92

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
