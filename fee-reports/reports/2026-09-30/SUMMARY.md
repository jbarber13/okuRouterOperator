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
| [arbitrum](./arbitrum.md) | 34 | $295.62 | $293.69 | $0.08 | `0x6fe38fe529ef97f2b41c706361b45618ae1d36f6b3ebbd1afa8817358a7fcb64` |
| [bsc](./bsc.md) | 56 | $233.66 | $190.85 | $0.10 | `0x1f7c6c38119cf2d4459960dd40ecc8a03e85c1c6e80ca7383836e033d4d86ec0` |
| [base](./base.md) | 80 | $170.47 | $170.05 | $0.05 | `0x201291ca7b782130fc6a05c0dc0b8923070ecd1b200624f823f5b56f255cadfb` |
| [mainnet](./mainnet.md) | 51 | $164.53 | $164.53 | $0.75 | `0x3c39b30ebae1405b2fb5b5b8eeac1ff143660bc58769b2d7eb4c99e793f4987e` |
| [mantle](./mantle.md) | 11 | $21.55 | $21.55 | $0.01 | `0x67a893d2182523ecf7ac538f2de8288a0b38df369333e53a1a41171a507e486f` |
| [monad](./monad.md) | 4 | $16.64 | $16.64 | $0.00 | `0x6983d5da36a74848fc317edd16b98cb2076e53c9099ca1fea7c02389e7fe4ed4` |
| [rootstock](./rootstock.md) | 2 | $2.45 | $2.45 | — | `0x672c395a5731ac11658da093ff92ccd617eec5ef67c95832011c6fac7cd430a1` |
| [op](./op.md) | 16 | $1.11 | $1.11 | $0.00 | `0xfe2aa2b137a88aa08af82bae1b2efcbbf79a58257271db8aff7545261fa12a1f` |
| [worldchain](./worldchain.md) | 10 | $0.39 | $0.39 | $0.00 | `0xd0048dbcb03ca4ec99a648dd6e9cf3013e8148ade70383e920c2746f42c88952` |
| [xdc](./xdc.md) | 2 | $0.24 | $0.24 | $0.00 | `0xca65c7a4373285cf1a6aa58b174e91904f370f6e8d60448136b1636c499a9a51` |
| [polygon](./polygon.md) | 6 | $0.24 | $0.24 | — | `0xd19207cef387066bd05a3cf472e3f1ae0e1d16fbef297b4b48e63ed4da356a0e` |
| [sei](./sei.md) | 1 | $0.06 | $0.06 | $0.00 | `0x09eb8dcbf879374fd1c38473121dbe5b2e30ec0d1cf638bee4ca2dfc997436a4` |
| [avax](./avax.md) | 15 | $0.00 | $0.00 | — | `0xca0c966c7627468c61a169d522afc05d04a04c6be71198b20dcaf4f3a98e6dc3` |
| [bob](./bob.md) | 1 | $0.00 | $0.00 | — | `0x4e70ca4df65a512e7fee125ec06390e35396556620c87f1971442a1b41947d3f` |
| [celo](./celo.md) | 5 | $0.00 | $0.00 | — | `0xa48dec930ad247f82c7c9a245003e05e3f21be71bdca8d9a519e41d40aac4c71` |
| [gnosis](./gnosis.md) | 2 | $0.00 | $0.00 | — | `0xc0a7bb3693e774399777212b91bce528d66fb5a30ce49b48b9ce3f885ba233cd` |
| [hyperevm](./hyperevm.md) | 23 | $0.00 | $0.00 | — | `0xe73dd3bf30519df9393da20d455a0386404010340f4270dc4bfa8a0ea9989403` |
| [linea](./linea.md) | 1 | $0.00 | $0.00 | $0.18 | `0x22d27368404e619d4b00ff8dc2b0976671980ad2519bdc0773e5a4021c8c48ae` |
| [plasma](./plasma.md) | 3 | $0.00 | $0.00 | — | `0xd2cbb868775fe7c97f5edaaf4fe48ba8eddb735be9796ce71812099ecf8700aa` |
| [robinhood](./robinhood.md) | 7 | $0.00 | $0.00 | — | `0x0ec3f5ada5185e7869470b767f60cee15859f259a58d20d09d79f176d26fdbc4` |
| [unichain](./unichain.md) | 4 | $0.00 | $0.00 | — | `0xd4d997bbf16b7eea263e23c5079e1fc6395ec6d4957d7189c0903201ddc5ded8` |
| [zerog](./zerog.md) | 1 | $0.00 | $0.00 | — | `0xe6f75d009ee7d0f1ed814d3a3477394684466442f5ac6d4d8da4ae433352f188` |

## Needs attention

- **arbitrum**: router still holds 2 asset(s)
- **arbitrum**: AAPLx (0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a): event reported 0.000000000000000002 but recipient received 0.000000000000000001 -- consistent with a fee-on-transfer or rebasing token
- **arbitrum**: NVDAx (0xc845b2894dBddd03858fd2D643B4eF725fE0849d): event reported 0.000000000000000001 but recipient received 0.0 -- consistent with a fee-on-transfer or rebasing token
- **mainnet**: router still holds 1 asset(s)
- **mainnet**: stETH (0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84): event reported 0.000000000000000003 but recipient received 0.000000000000000002 -- consistent with a fee-on-transfer or rebasing token

Realizable caps each asset at a fraction of its pool depth; notional does not. Use realizable.
