# Fee collection — 2026-09-30 (2026-W40)

| | |
|---|---|
| Chains swept | 22 |
| Assets moved | 335 |
| Notional | $906.98 |
| **Realizable** | **$861.82** |
| Gas spent | $1.18 |
| Fully reconciled | NO — 2 chain(s) |

| Chain | Assets | Notional | Realizable | Gas | Tx |
|---|---:|---:|---:|---:|---|
| [arbitrum](./arbitrum.md) | 34 | $295.62 | $293.69 | $0.08 | `0x6fe38fe529…` |
| [bsc](./bsc.md) | 56 | $233.66 | $190.85 | $0.10 | `0x1f7c6c3811…` |
| [base](./base.md) | 80 | $170.47 | $170.05 | $0.05 | `0x201291ca7b…` |
| [mainnet](./mainnet.md) | 51 | $164.53 | $164.53 | $0.75 | `0x3c39b30eba…` |
| [mantle](./mantle.md) | 11 | $21.55 | $21.55 | $0.01 | `0x67a893d218…` |
| [monad](./monad.md) | 4 | $16.64 | $16.64 | $0.00 | `0x6983d5da36…` |
| [rootstock](./rootstock.md) | 2 | $2.45 | $2.45 | — | `0x672c395a57…` |
| [op](./op.md) | 16 | $1.11 | $1.11 | $0.00 | `0xfe2aa2b137…` |
| [worldchain](./worldchain.md) | 10 | $0.39 | $0.39 | $0.00 | `0xd0048dbcb0…` |
| [xdc](./xdc.md) | 2 | $0.24 | $0.24 | $0.00 | `0xca65c7a437…` |
| [polygon](./polygon.md) | 6 | $0.24 | $0.24 | — | `0xd19207cef3…` |
| [sei](./sei.md) | 1 | $0.06 | $0.06 | $0.00 | `0x09eb8dcbf8…` |
| [avax](./avax.md) | 15 | $0.00 | $0.00 | — | `0xca0c966c76…` |
| [bob](./bob.md) | 1 | $0.00 | $0.00 | — | `0x4e70ca4df6…` |
| [celo](./celo.md) | 5 | $0.00 | $0.00 | — | `0xa48dec930a…` |
| [gnosis](./gnosis.md) | 2 | $0.00 | $0.00 | — | `0xc0a7bb3693…` |
| [hyperevm](./hyperevm.md) | 23 | $0.00 | $0.00 | — | `0xe73dd3bf30…` |
| [linea](./linea.md) | 1 | $0.00 | $0.00 | $0.18 | `0x22d2736840…` |
| [plasma](./plasma.md) | 3 | $0.00 | $0.00 | — | `0xd2cbb86877…` |
| [robinhood](./robinhood.md) | 7 | $0.00 | $0.00 | — | `0x0ec3f5ada5…` |
| [unichain](./unichain.md) | 4 | $0.00 | $0.00 | — | `0xd4d997bbf1…` |
| [zerog](./zerog.md) | 1 | $0.00 | $0.00 | — | `0xe6f75d009e…` |

## Needs attention

- **arbitrum**: router still holds 2 asset(s)
- **arbitrum**: AAPLx (0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a): event reported 0.000000000000000002 but recipient received 0.000000000000000001 -- consistent with a fee-on-transfer or rebasing token
- **arbitrum**: NVDAx (0xc845b2894dBddd03858fd2D643B4eF725fE0849d): event reported 0.000000000000000001 but recipient received 0.0 -- consistent with a fee-on-transfer or rebasing token
- **mainnet**: router still holds 1 asset(s)
- **mainnet**: stETH (0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84): event reported 0.000000000000000003 but recipient received 0.000000000000000002 -- consistent with a fee-on-transfer or rebasing token

Realizable caps each asset at a fraction of its pool depth; notional does not. Use realizable.
