## What changed

<!-- Brief description of the change -->

**Type**: [ ] feature / [ ] fix / [ ] refactor / [ ] chore

## Pre-merge checklist

- [ ] `npm run test && npm run check && npm run lint` passes
- [ ] No new `any` types introduced
- [ ] No `BroadcastMessage.type` string values changed (wire protocol — see CLAUDE.md)
- [ ] No renamed exports from `game.ts`
- [ ] Components use Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) — no legacy `$:`
- [ ] Stores use legacy `writable()`/`derived()`/`get()` — no runes

### If touching grid or optimistic flow

- [ ] `.then()` pattern in optimistic functions preserved (not converted to `await`)
- [ ] Pending operations Map key format unchanged (`row-col`)
- [ ] Broadcast channel messages tested with multiple clients

### If touching SQL / migrations

- [ ] New migration file created (existing migrations not modified)
- [ ] `player_name_lower` never set directly (it's `GENERATED ALWAYS`)
- [ ] Splits CHECK constraint respected (`split_q1 + split_q2 + split_q3 + split_final = 100`)
