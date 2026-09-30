# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | unichain (chainId 130) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xd4d997bbf16b7eea263e23c5079e1fc6395ec6d4957d7189c0903201ddc5ded8` |
| Block | 59990341 (2026-09-30T03:25:00.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 243243 @ 1500000 wei = 0.0000003648645 |
| Status | success |
| Generated | 2026-09-30T03:25:03.020Z |

## Assets swept (4)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDC | 12.538831 | - | - | yes |
| XRP | 1.032899301094833651 | - | - | yes |
| XVS | 0.743333173885315104 | - | - | yes |
| USD₮0 | 0.211249 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for unichain; valuations unavailable
