# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | hyperevm (chainId 999) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0xe73dd3bf30519df9393da20d455a0386404010340f4270dc4bfa8a0ea9989403` |
| Block | 47256276 (2026-09-30T03:15:05.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 951525 @ 346895249 wei = 0.000330079501804725 |
| Status | success |
| Generated | 2026-09-30T03:15:22.614Z |

## Assets swept (23)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| KNTQ | 8.78288255418 | - | - | yes |
| NEST | 1053.796341741904926343 | - | - | yes |
| stLOOP | 18.51373131282625809 | - | - | yes |
| JEFF | 0.0135 | - | - | yes |
| WHYPE | 0.005453585188546566 | - | - | yes |
| KITTEN | 4.221871460968326837 | - | - | yes |
| HPL | 12.1780057617 | - | - | yes |
| wNVDAx | 0.000262819000798557 | - | - | yes |
| kHYPE | 0.000245963831346805 | - | - | yes |
| thBILL | 0.025385 | - | - | yes |
| CATBAL | 0.933635997135 | - | - | yes |
| UXPL | 3.592683367939466873 | - | - | yes |
| Hyperliquid | 365.690049 | - | - | yes |
| PURR | 18.261759332095389684 | - | - | yes |
| UPUMP | 270.630308 | - | - | yes |
| RAM | 11.322524945423454861 | - | - | yes |
| US | 9.68274 | - | - | yes |
| USDHL | 0.05 | - | - | yes |
| PENIS | 0.1668231422 | - | - | yes |
| QUANT | 0.34 | - | - | yes |
| HAR | 1.280479504429232189 | - | - | yes |
| DRV | 3.745195547671865566 | - | - | yes |
| HYPE | 0.0004 | - | - | yes |

**Notional:** $0.00  
**Realizable:** $0.00

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- no V3 factory/USDC/WETH for hyperevm; valuations unavailable
