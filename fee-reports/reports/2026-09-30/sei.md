# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | sei (chainId 1329) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0x7B060A98BA242Ae42D6027a60937787eBe33DEBe` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x09eb8dcbf879374fd1c38473121dbe5b2e30ec0d1cf638bee4ca2dfc997436a4` |
| Block | 234895123 (2026-09-30T03:15:24.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 83667 @ 51000000000 wei = 0.004267017 ($0.00) |
| Status | success |
| Generated | 2026-09-30T03:15:29.085Z |

## Assets swept (1)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| SEI | 0.3 | $0.06 | $0.06 | yes |

**Notional:** $0.06  
**Realizable:** $0.06

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
