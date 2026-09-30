# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | gnosis (chainId 100) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xc0a7bb3693e774399777212b91bce528d66fb5a30ce49b48b9ce3f885ba233cd` |
| Block | 48509719 (2026-09-30T03:14:25.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 136409 @ 14 wei = 0.000000000001909726 |
| Status | success |
| Generated | 2026-09-30T03:14:28.732Z |

## Assets swept (2)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| GBPe | 0.044 | - | - | yes |
| XDAI | 0.810656719210088823 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- could not read USDC decimals; assuming 6
- gnosis: no WETH/USDC pool with usable liquidity; native and WETH-quoted assets are unpriced
