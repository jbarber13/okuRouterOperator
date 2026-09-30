# Fee Sweep - Execution Record

| | |
|---|---|
| Date | 2026-09-30 (2026-W40) |
| Network | arbitrum (chainId 42161) |
| Bundle | `sweep-recovery-2026-09-30` |
| Router | `0xb1f3a7B816B0681188F54dFa400991B93ADf00ed` |
| Safe | `0xdC91978e0617CcA2EE1E658d0A1CA3F63CF10f1F` |
| Recipient | `0x8288Ba381e07EA5E9Fc4053a97545161D7d4683C` |
| Tx | `0x6fe38fe529ef97f2b41c706361b45618ae1d36f6b3ebbd1afa8817358a7fcb64` |
| Block | 510230756 (2026-09-30T03:38:19.000Z) |
| Safe nonce | 2 |
| Signers | `0x43A9beCdC1323c1dFcfA776cE9bF57F9F8Ce8200`, `0x9B68c14e936104e9a7a24c712BEecdc220002984` |
| Gas | 1586903 @ 20004000 wei = 0.000031744407612 ($0.08) |
| Status | success |
| Generated | 2026-09-30T03:38:54.559Z |

## Assets swept (34)

| Asset | Amount | USD | Realizable | Verified |
|---|---:|---:|---:|---|
| USDC | 152.760233 | $152.74 | $152.74 | yes |
| USD₮0 | 84.92059 | $84.87 | $84.87 | yes |
| PEAR | 840.0 | $21.17 | $21.17 | yes |
| weETH | 0.004466926942624633 | $13.14 | $13.14 | yes |
| EURe | 4.0036 | $4.54 | $2.61 | yes |
| UNI | 0.223509361150685036 | $1.96 | $1.96 | yes |
| AAVE | 0.010341629493747669 | $1.65 | $1.65 | yes |
| ATH | 253.9332 | $1.52 | $1.52 | yes |
| ETHFI | 1.875243832509187786 | $1.45 | $1.45 | yes |
| rETH | 0.000441678245944877 | $1.38 | $1.38 | yes |
| GNS | 2.1054710562361862 | $1.03 | $1.03 | yes |
| ARB | 4.567989368802262677 | $0.93 | $0.93 | yes |
| DAI | 0.545018410882428718 | $0.54 | $0.54 | yes |
| AIDOGE | 44845451096.606 | $0.51 | $0.51 | yes |
| wstETH | 0.000101953839937627 | $0.34 | $0.34 | yes |
| SYN | 1.535105712826299486 | $0.26 | $0.26 | yes |
| WBTC | 0.00000037 | $0.03 | $0.03 | yes |
| WETH | 0.000009340330711476 | $0.02 | $0.02 | yes |
| UMAMI | 0.580550651 | $0.01 | $0.01 | yes |
| USDC | 0.00082 | $0.00 | $0.00 | yes |
| L3 | 0.105510173354120682 | $0.00 | $0.00 | yes |
| sUSDai | 41.644549798512328262 | - | - | yes |
| rNVDA | 0.00010364620725 | - | - | yes |
| DOC | 78.540472766 | - | - | yes |
| RBTC | 0.000402370837244908 | - | - | yes |
| PYUSD | 0.248265 | - | - | yes |
| rSPCX | 0.000079116377322351 | - | - | yes |
| GHO | 5.01519422555681225 | - | - | yes |
| AAPLx | 0.000000000000000001 | - | - | **MISMATCH** |
| WMTX | 4.201786 | - | - | yes |
| rAAPL | 0.00042896369317 | - | - | yes |
| NVDAx | 0.0 | - | - | **MISMATCH** |
| rTSLA | 0.0002023558695 | - | - | yes |
| ETH | 0.002817276180358377 | $7.53 | $7.53 | yes |

**Notional:** $295.62  
**Realizable:** $293.69

Notional is spot price x amount. Realizable caps each asset at a fraction of its pool depth, because long-tail tokens quote prices against pools with no liquidity. Realizable is the meaningful figure.

## Reconciliation

- Router fully drained: **NO**
- Events match measured balance deltas: **NO**

### Residual balances remaining on the router

- AAPLx: 0.000000000000000001 (`0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a`)
- NVDAx: 0.000000000000000001 (`0xc845b2894dBddd03858fd2D643B4eF725fE0849d`)

### Discrepancies

- AAPLx (0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a): event reported 0.000000000000000002 but recipient received 0.000000000000000001 -- consistent with a fee-on-transfer or rebasing token
- NVDAx (0xc845b2894dBddd03858fd2D643B4eF725fE0849d): event reported 0.000000000000000001 but recipient received 0.0 -- consistent with a fee-on-transfer or rebasing token
