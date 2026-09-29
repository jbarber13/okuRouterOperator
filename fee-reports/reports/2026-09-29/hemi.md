# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | hemi (chainId 43111) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x7B060A98BA242Ae42D6027a60937787eBe33DEBe` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xfd99e4abdccdf6971fc10e4bdf31da4f951751c4fd58f76911b2ae39d0d487c0` |
| Block | 5403665 (2026-09-29T19:38:11.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 218502 @ 1000252 wei = 0.000000218557062504 |
| Status | success |
| Generated | 2026-09-29T19:38:12.664Z |

## Assets swept (4)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WETH | 0.0003 | - | - | yes |
| HEMI | 38.00179320677575573 | - | - | yes |
| USDC.e | 2.25 | - | - | yes |
| ETH | 0.000083617593074631 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for hemi; valuations unavailable
