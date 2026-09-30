# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | bob (chainId 60808) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0x3132f599bde0e251ba12d5FF95E256FbBeCbDA83` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x4e70ca4df65a512e7fee125ec06390e35396556620c87f1971442a1b41947d3f` |
| Block | 38938170 (2026-09-30T03:18:47.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 83655 @ 1000252 wei = 0.00000008367608106 |
| Status | success |
| Generated | 2026-09-30T03:18:49.637Z |

## Assets swept (1)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| ETH | 0.000718492522273573 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for bob; valuations unavailable
