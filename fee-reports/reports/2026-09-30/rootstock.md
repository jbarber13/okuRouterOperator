# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | rootstock (chainId 30) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0x0906896E8564c61F40778E2B7A46E1269Aaa681e` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x672c395a5731ac11658da093ff92ccd617eec5ef67c95832011c6fac7cd430a1` |
| Block | 9283592 (2026-09-30T03:10:59.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 92074 @ 26065600 wei = 0.0000023999640544 |
| Status | success |
| Generated | 2026-09-30T03:11:34.768Z |

## Assets swept (2)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDRIF | 2.453492134291371204 | $2.45 | $2.45 | yes |
| RBTC | 0.000290114760448138 | - | - | yes |

**Notional:** $2.45  
**Realizable:** $2.45

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- rootstock: no WETH/USDC pool with usable liquidity; native and WETH-quoted assets are unpriced
