# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-10-16 (2026-W42) |
| Network | hyperevm (chainId 999) |
| Bundle | `sweep-2026-10-15` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0x37333A9626E99eC2012F3cC47a062649CF741303` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x85f40e2f763d7a455a8be6679cafff0e899a9cd167a4bd66aa982217315fcd78` |
| Block | 48707157 (2026-10-16T15:42:32.000Z) |
| Safe nonce | 2 |
| Signers | `0x46e9CF7694535b4Ba5a7ba09f6c54B05CE7A85E3`, `0x5348bb6318f5Dc05C4501BA8D9b543666ec772e8` |
| Gas | 511743 @ 611466123 wei = 0.000312913508182389 ($0.02) |
| Status | success |
| Generated | 2026-10-16T15:42:43.461Z |

## Assets swept (14)

| Asset | Amount | USD | Price source | Verified |
|---|---:|---:|---|---|
| NEST | 71004.52672966367557166 | $1198.38 | llama-historical@1792164180 | yes |
| USDC | 1221.944404 | $1221.76 | llama-historical@1792165322 | yes |
| WHYPE | 25.179593482713824266 | $1991.00 | llama-historical@1792165322 | yes |
| USD₮0 | 0.674189 | $0.67 | llama-historical@1792165322 | yes |
| CATBAL | 1.00266264468 | $0.61 | llama-historical@1792152482 | yes |
| KNTQ | 926.520320944593788919 | $278.65 | llama-historical@1792164180 | yes |
| BASED | 3.777850167 | $0.20 | llama-historical@1792164180 | yes |
| PURR | 1.157141917700018548 | $0.11 | llama-historical@1792164180 | yes |
| USDe | 0.1 | $0.10 | llama-historical@1792165322 | yes |
| wNVDAx | 0.000178077234126555 | $0.04 | llama-historical@1792165058 | yes |
| SKHYx | 0.000000000000000004 | $0.00 | llama-historical@1792165010 | **MISMATCH** |
| stLOOP | 7.4154055832 | - | unpriced:no-source | yes |
| LILLY | 1.0 | $0.00 | llama-historical@1792161472 | yes |
| HYPE | 0.142253107162861531 | $11.25 | llama-historical@1792165322 | yes |

**Notional:** $4702.78  
**Unpriced:** 1 of 14 asset(s) carried no USD value and contributed $0 to the figure above.

Priced from DefiLlama as of the execution block, so this figure does not move when the report is regenerated. There is no liquidity signal: nothing here says whether these assets could be sold at these prices.

## Reconciliation

- Router fully drained: **NO**
- Events match measured balance deltas: **NO**

### Residual balances remaining on the router

- SKHYx: 0.000000000000000001 (`0x58100046a4Afcd4eE4faDbD4244f3f895a341c56`)

### Discrepancies

- SKHYx (0x58100046a4Afcd4eE4faDbD4244f3f895a341c56): event reported 0.000000000000000005 but recipient received 0.000000000000000004 -- consistent with a fee-on-transfer or rebasing token

### Warnings

- hyperevm: 1 asset(s) have no DefiLlama quote and are reported unpriced, contributing $0 to the totals.
