# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-10-30 (2026-W44) |
| Network | goat (chainId 2345) |
| Bundle | `sweep-2026-10-30` |
| Router | `0x7B060A98BA242Ae42D6027a60937787eBe33DEBe` |
| Safe | `0x37333A9626E99eC2012F3cC47a062649CF741303` |
| Recipient | `0x7C547b4760feC978a26c76FE451BA3F5B00237C6` |
| Tx | `0x77f0eba7663b525230f7dccfa7b8fe2d47b7490ebd35686c9fcc68c9aa4d35f5` |
| Block | 16479898 (2026-10-30T16:45:14.000Z) |
| Safe nonce | 1 |
| Signers | `0x46e9CF7694535b4Ba5a7ba09f6c54B05CE7A85E3`, `0x5348bb6318f5Dc05C4501BA8D9b543666ec772e8` |
| Gas | 313784 @ 130007 wei = 0.000000040794116488 ($0.00) |
| Status | success |
| Generated | 2026-10-30T16:45:16.664Z |

## Assets swept (6)

| Asset | Amount | USD | Price source | Verified |
|---|---:|---:|---|---|
| USDC.e | 15.531784 | $15.53 | llama-historical@1793378510 | yes |
| BANG | 4410.264915274559367135 | - | unpriced:no-market | yes |
| GOATED | 311.306992788351272472 | $3.71 | llama-historical@1793377375 | yes |
| USDT | 0.249925 | $0.25 | llama-historical@1793378679 | yes |
| BTCB | 0.00000295611364002 | $0.23 | alias:coingecko:binance-bitcoin@1793377375 | yes |
| BTC | 0.000027793835704495 | $2.15 | alias:coingecko:bitcoin@1793378695 | yes |

**Notional:** $21.87  
**Unpriced:** 1 of 6 asset(s) carried no USD value and contributed $0 to the figure above.

Priced as of the execution block (DefiLlama historical; reviewed aliases; GeckoTerminal current price only when recorded within an hour of execution), so this figure does not move when the report is regenerated. Only firm prices are counted.

## Reconciliation

- Router fully drained: **yes**
- Events match measured balance deltas: **yes**

### Warnings

- goat: 0 thin price(s) shown but not counted, 1 asset(s) unpriced
