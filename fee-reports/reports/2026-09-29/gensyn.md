# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | gensyn (chainId 685689) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xbf3db9b56d9e1659c854d9a1332d71e28703560edeaa4ff41c99f96f0707b0cd` |
| Block | 15997280 (2026-09-29T19:38:39.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 108631 @ 1000250 wei = 0.00000010865815775 |
| Status | success |
| Generated | 2026-09-29T19:38:40.714Z |

## Assets swept (1)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| ETH | 0.000657549092102386 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for gensyn; valuations unavailable
