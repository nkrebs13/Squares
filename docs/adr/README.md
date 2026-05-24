# Architecture Decision Records

These ADRs document the non-obvious technical choices made in this codebase. Each follows the Context → Decision → Consequences structure and includes a Mermaid diagram.

| #                                      | Title                   | One-line summary                                                              |
| -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| [0001](0001-hybrid-reactivity.md)      | Hybrid Reactivity Model | Svelte stores in `stores/`, runes in components — never convert between them  |
| [0002](0002-optimistic-chain.md)       | Optimistic Update Chain | `.then()` (non-blocking) instead of `await` keeps broadcast and RPC decoupled |
| [0003](0003-dual-realtime-channels.md) | Dual Realtime Channels  | Broadcast for speed, `postgres_changes` for correctness — both are necessary  |
