# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-29 (2026-W40) |
| Network | bsc (chainId 56) |
| Bundle | `sweep-2026-09-29` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x9077e5c9cb2902179bb815e328e2f6274737949146936af4a2f92c31f17c8e48` |
| Block | 124773167 (2026-09-29T19:32:24.000Z) |
| Safe nonce | 1 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 245532 @ 50000000 wei = 0.0000122766 ($0.01) |
| Status | success |
| Generated | 2026-09-29T19:41:19.873Z |

## Assets swept (5)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| BTCB | 0.000852010145297984 | $71.08 | $71.08 | event only |
| USDC | 5.232678777336313175 | $5.23 | $5.23 | event only |
| ETH | 0.000655966060652345 | $1.77 | $1.77 | event only |
| WBNB | 0.00128681861388655 | $0.97 | $0.97 | event only |
| BNB | 0.023225318719407112 | $17.52 | $17.52 | event only |

**Notional:** $96.57  
**Realizable:** $96.57

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- RPC would not serve historical state; amounts are taken from events only and a fee-on-transfer token could therefore be overstated
