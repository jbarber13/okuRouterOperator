# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | mainnet (chainId 1) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x3c39b30ebae1405b2fb5b5b8eeac1ff143660bc58769b2d7eb4c99e793f4987e` |
| Block | 26087508 (2026-09-30T03:08:47.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 2230644 @ 125669130 wei = 0.00028032309081972 ($0.75) |
| Status | success |
| Generated | 2026-09-30T03:09:58.912Z |

## Assets swept (51)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| WLD | 150.0 | $73.93 | $73.93 | yes |
| LINK | 2.115239505381213818 | $30.51 | $30.51 | yes |
| PYUSD | 12.048865 | $12.05 | $12.05 | yes |
| PAXG | 0.002596010963084186 | $10.88 | $10.88 | yes |
| cbBTC | 0.00012737 | $10.61 | $10.61 | yes |
| EURI | 4.0 | $4.44 | $4.44 | yes |
| SKY | 36.39 | $2.98 | $2.98 | yes |
| CFG | 17.457877 | $2.67 | $2.67 | yes |
| pufETH | 0.000733716311863764 | $2.12 | $2.12 | yes |
| ETHFI | 2.51334960676810612 | $1.95 | $1.95 | yes |
| IMD | 0.258836214173508428 | $1.70 | $1.70 | yes |
| stkAAVE | 0.01 | $1.62 | $1.62 | yes |
| EIGEN | 4.206459195602001157 | $1.05 | $1.05 | yes |
| USDC | 1.453668 | $1.45 | $1.45 | yes |
| DPI | 0.00782126208855623 | $0.56 | $0.56 | yes |
| AZTEC | 26.013168430049898355 | $0.43 | $0.43 | yes |
| AGRS | 1.07484 | $0.40 | $0.40 | yes |
| USDG | 0.347901 | $0.35 | $0.35 | yes |
| USDT | 2.032066 | $2.03 | $2.03 | yes |
| YB | 3.083682688472775724 | $0.28 | $0.28 | yes |
| TAIKO | 2.513349606768106121 | $0.25 | $0.25 | yes |
| ENSO | 0.24694222082466038 | $0.24 | $0.24 | yes |
| SPEC | 21.039912719174813726 | $0.17 | $0.17 | yes |
| wQUIL | 25.46558 | $0.16 | $0.16 | yes |
| ZRX | 1.261804788428203112 | $0.15 | $0.15 | yes |
| tBTC | 0.00000143934384671 | $0.12 | $0.12 | yes |
| AAVE | 0.00063768 | $0.10 | $0.10 | yes |
| WBTC | 0.00000096 | $0.08 | $0.08 | yes |
| PUFFER | 2.513349606768106121 | $0.07 | $0.07 | yes |
| EURCV | 0.044676 | $0.05 | $0.05 | yes |
| ALCX | 0.01756265602194 | $0.05 | $0.05 | yes |
| SAFE | 0.334193932056260773 | $0.04 | $0.04 | yes |
| GHO | 0.031451194425939166 | $0.03 | $0.03 | yes |
| cirBTC | 0.00000032 | $0.03 | $0.03 | yes |
| AAPLon | 0.000037096623739985 | $0.01 | $0.01 | yes |
| CVX | 0.001524992294088176 | $0.00 | $0.00 | yes |
| MON | 0.27 | $0.00 | $0.00 | yes |
| stETH | 0.000000000000000002 | $0.00 | $0.00 | **MISMATCH** |
| hemiBTC | 0.00005819 | - | - | yes |
| ISLAND | 793.4967 | - | - | yes |
| CPERon | 0.104078005963950788 | - | - | yes |
| EDEN | 0.440682 | - | - | yes |
| ALIGN | 73.597892886707852916 | - | - | yes |
| ARC | 79.93664 | - | - | yes |
| CHEQ | 28.135513425 | - | - | yes |
| apxUSD | 0.510751 | - | - | yes |
| USDtb | 0.013697413745844158 | - | - | yes |
| frxUSD | 0.752835526627577257 | - | - | yes |
| sUSDat | 0.240775577972601811 | - | - | yes |
| cUSD | 11.416893611408367933 | - | - | yes |
| ETH | 0.000364263377664116 | $0.97 | $0.97 | yes |

**Notional:** $164.53  
**Realizable:** $164.53

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **NO**
- Events match measured balance deltas: **NO**

### Residual balances remaining on the router

- stETH: 0.000000000000000001 (`0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`)

### Discrepancies

- stETH (0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84): event reported 0.000000000000000003 but recipient received 0.000000000000000002 -- consistent with a fee-on-transfer or rebasing token
