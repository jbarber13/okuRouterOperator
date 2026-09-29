# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | boba (chainId 288) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x7bf7770Ecd4fd573C32272Ef80c8818A8E8e289A` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x2a7d1dd5f3b4da51fee31df28e4db0fadf1b807b8e15a459867b7018e5942cb5` |
| Block | 39852806 (2026-09-29T19:34:13.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 136734 @ 1000252 wei = 0.000000136768456968 ($0.00) |
| Status | success |
| Generated | 2026-09-29T19:34:16.693Z |

## Assets swept (2)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDC | 4.000949 | $4.00 | $4.00 | yes |
| WETH | 0.0009 | $2.43 | $2.43 | yes |

**Notional:** $6.43  
**Realizable:** $6.43

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
