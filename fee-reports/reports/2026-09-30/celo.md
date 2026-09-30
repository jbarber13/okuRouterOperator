# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | celo (chainId 42220) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xa48dec930ad247f82c7c9a245003e05e3f21be71bdca8d9a519e41d40aac4c71` |
| Block | 78837550 (2026-09-30T03:18:28.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 530857 @ 200001000000 wei = 0.106171930857 |
| Status | success |
| Generated | 2026-09-30T03:18:31.753Z |

## Assets swept (5)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| UBE | 0.746957799336890471 | - | - | yes |
| USD₮ | 0.354343 | - | - | yes |
| G$ | 272936.126925927968619026 | - | - | yes |
| MOBI | 1498.176749440062155782 | - | - | yes |
| USDm | 0.008840931662295149 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for celo; valuations unavailable
