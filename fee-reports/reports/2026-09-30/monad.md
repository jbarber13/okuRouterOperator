# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | monad (chainId 143) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x6983d5da36a74848fc317edd16b98cb2076e53c9099ca1fea7c02389e7fe4ed4` |
| Block | 109212052 (2026-09-30T03:14:40.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 505010 @ 102000000000 wei = 0.05151102 ($0.00) |
| Status | success |
| Generated | 2026-09-30T03:14:46.032Z |

## Assets swept (4)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WBTC | 0.00000011 | $0.01 | $0.01 | yes |
| WMON | 0.250705187677429874 | $0.01 | $0.01 | yes |
| XAUt0 | 0.000001 | - | - | yes |
| MON | 620.750488723075801258 | $16.63 | $16.63 | yes |

**Notional:** $16.64  
**Realizable:** $16.64

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
