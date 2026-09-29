# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | etherlink (chainId 42793) |
| Bundle | `sweep-2026-09-29` |
| Router | `0x7B060A98BA242Ae42D6027a60937787eBe33DEBe` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x94a6f450462dfb7218b59e070a023c62a4fd4c683a50efe7100206535e370cce` |
| Block | 54534255 (2026-09-29T19:37:58.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 3676903 @ 1000000000 wei = 0.003676903 ($0.00) |
| Status | success |
| Generated | 2026-09-29T19:38:01.924Z |

## Assets swept (1)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDC | 0.099306 | $0.10 | $0.10 | yes |

**Notional:** $0.10  
**Realizable:** $0.10

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**
