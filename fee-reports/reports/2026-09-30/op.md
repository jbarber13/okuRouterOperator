# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | op (chainId 10) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xfe2aa2b137a88aa08af82bae1b2efcbbf79a58257271db8aff7545261fa12a1f` |
| Block | 157569512 (2026-09-30T03:10:01.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 661518 @ 1001042 wei = 0.000000662207301756 ($0.00) |
| Status | success |
| Generated | 2026-09-30T03:10:20.149Z |

## Assets swept (16)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| OP | 3.016841877230775554 | $0.39 | $0.39 | yes |
| wstETH | 0.00007223 | $0.24 | $0.24 | yes |
| VELO | 6.421915134390312159 | $0.22 | $0.22 | yes |
| USDT | 0.158001 | $0.16 | $0.16 | yes |
| WBTC | 0.00000052 | $0.04 | $0.04 | yes |
| WLD | 0.050783029234530706 | $0.02 | $0.02 | yes |
| USDC | 0.016894 | $0.02 | $0.02 | yes |
| WETH | 0.000003475726405771 | $0.01 | $0.01 | yes |
| DAI | 0.002010148645129295 | $0.00 | $0.00 | yes |
| weETH | 0.000000115400587745 | $0.00 | $0.00 | yes |
| rETH | 0.000000026084541579 | $0.00 | $0.00 | yes |
| axlUSDC | 0.00001 | $0.00 | $0.00 | yes |
| USD₮0 | 1.25271 | - | - | yes |
| msETH | 0.000002176537855589 | - | - | yes |
| msUSD | 0.001731437049813058 | - | - | yes |
| alUSD | 0.001743235795147068 | - | - | yes |

**Notional:** $1.11  
**Realizable:** $1.11

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
