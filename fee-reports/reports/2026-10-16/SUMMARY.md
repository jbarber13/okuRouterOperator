# Fee collection — 2026-10-16 (2026-W42)

| | |
|---|---|
| Chains swept | 1 |
| Assets moved | 14 |
| Notional | $4702.78 |
| Gas spent | $0.02 |
| Fully reconciled | NO — 1 chain(s) |

| Chain | Assets | Notional | Realizable | Gas | Tx |
|---|---:|---:|---:|---:|---|
| [hyperevm](./hyperevm.md) | 14 | $4702.78 | — | $0.02 | `0x85f40e2f763d7a455a8be6679cafff0e899a9cd167a4bd66aa982217315fcd78` |

## Needs attention

- **hyperevm**: router still holds 1 asset(s)
- **hyperevm**: SKHYx (0x58100046a4Afcd4eE4faDbD4244f3f895a341c56): event reported 0.000000000000000005 but recipient received 0.000000000000000004 -- consistent with a fee-on-transfer or rebasing token

Realizable caps each asset at a fraction of its pool depth; notional does not. Use realizable.
