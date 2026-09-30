# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | mantle (chainId 5000) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0x86d61277970685075a0BF66023c219dc4A6e3F6d` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x67a893d2182523ecf7ac538f2de8288a0b38df369333e53a1a41171a507e486f` |
| Block | 101303914 (2026-09-30T03:15:40.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 449037 @ 50000100000 wei = 0.0224518949037 ($0.01) |
| Status | success |
| Generated | 2026-09-30T03:16:19.260Z |

## Assets swept (11)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| BILLI | 65238.900065330350297008 | $18.98 | $18.98 | yes |
| mETH | 0.000525799336131466 | $1.54 | $1.54 | yes |
| NFP | 317200.189491317460064318 | $0.55 | $0.55 | yes |
| WMNT | 0.025833069774719973 | $0.02 | $0.02 | yes |
| syrupUSDT | 0.218567 | - | - | yes |
| MOE | 3.240823909657841897 | - | - | yes |
| wstETH | 0.000632527225781566 | - | - | yes |
| USDe | 12.20461143 | - | - | yes |
| USDT0 | 1.856719 | - | - | yes |
| SCOR | 11.97196605 | - | - | yes |
| MNT | 0.684492974572085971 | $0.45 | $0.45 | yes |

**Notional:** $21.55  
**Realizable:** $21.55

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
