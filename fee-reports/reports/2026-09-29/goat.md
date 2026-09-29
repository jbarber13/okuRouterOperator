# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | goat (chainId 2345) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x7B060A98BA242Ae42D6027a60937787eBe33DEBe` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x0587bb79c71046df51556cd27c4634700fd41efdf326fc67cb861db4954656d3` |
| Block | 15720872 (2026-09-29T19:36:22.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 259036 @ 130007 wei = 0.000000033676493252 |
| Status | success |
| Generated | 2026-09-29T19:36:24.622Z |

## Assets swept (5)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| GOATED | 22.81716 | $0.35 | $0.35 | yes |
| USDC.e | 0.3 | $0.30 | $0.30 | yes |
| BANG | 9085.360552 | - | - | yes |
| BTCB | 0.000003078699667073 | - | - | yes |
| BTC | 0.000033908909781956 | - | - | yes |

**Notional:** $0.65  
**Realizable:** $0.65

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- goat: the configured WETH is not the wrapped form of BTC, so the native balance is left unpriced rather than valued as ether.
