# Football Squares

## Project Overview

Football Squares — a real-time Super Bowl squares pool app. SvelteKit 5, Supabase (Postgres + Realtime), Tailwind 4, deployed on Cloudflare Pages. Production app, Super Bowl Sunday usage expected.

## CRITICAL: Hybrid Reactivity Model

- **STORES** (`src/lib/stores/*.ts`) use **legacy Svelte stores**: `writable()`, `derived()`, `get()` from `svelte/store` — **DO NOT convert to runes**
- **COMPONENTS** (`src/lib/components/*.svelte`) use **Svelte 5 runes**: `$state()`, `$derived()`, `$effect()`, `$props()` — **DO NOT use legacy `$:` syntax**
- Routes use runes for reactive params

## Architecture Quick Reference

- **Create flow**: Lives in `src/routes/create/+page.svelte` (NOT in game.ts). Does 3 sequential Supabase inserts (party → 100 squares → scores) with manual rollback. Must remain self-contained.
- **Game flow**: `src/lib/stores/game.ts` → RPCs + Realtime subscriptions
- **Dual Realtime channels**: `subscribeToParty()` creates a broadcast channel (fast optimistic updates) AND a postgres_changes channel (5 tables: squares, parties, numbers, scores, winners). postgres_changes is source of truth.

### Optimistic Update Chain (do not alter)

1. User action → `claimSquareOptimistic()`
2. Pending op added to `pendingOperations` Map (keyed `row-col`)
3. Local `squares` store updated immediately
4. Broadcast sent via Supabase Realtime broadcast channel
5. Timeout scheduled at 10,000ms
6. **RPC fires via `.then()` pattern (non-blocking, NOT `await`)** — intentional, do not "improve" to await
7. On success: `postgres_changes` clears pending op
8. On failure: rollback to `originalState`, broadcast `claim_rejected`, toast error

### State Machine

`filling` → `active` → `complete`

The `locked` status exists in the DB CHECK constraint and frontend rendering but is never set by current RPCs — `lock_party` jumps directly to `active`. Do NOT remove `locked` from the type or frontend.

### Dead Code

`startGame()` function in game.ts (line ~900-920) and `start_game` RPC — no matching SQL function exists. Do not use or test.

## Database Constraints

- `player_name_lower` is `GENERATED ALWAYS AS (LOWER(player_name)) STORED` — never set directly in INSERT/UPDATE, only set `player_name`
- Splits CHECK: `split_q1 + split_q2 + split_q3 + split_final = 100`
- Winners UNIQUE on `(party_id, quarter)`

## RPC Signatures

| RPC                   | Parameters                                                                                   | Returns   |
| --------------------- | -------------------------------------------------------------------------------------------- | --------- |
| `claim_square`        | `p_party_id UUID, p_row INT, p_col INT, p_player_name VARCHAR(50)`                           | `BOOLEAN` |
| `unclaim_square`      | same pattern                                                                                 | `BOOLEAN` |
| `claim_squares_batch` | `p_party_id UUID, p_player_name VARCHAR(50), p_cells JSONB`                                  | `INTEGER` |
| `lock_party`          | `p_party_id UUID, p_pin VARCHAR(4)`                                                          | `BOOLEAN` |
| `update_score`        | `p_party_id UUID, p_pin VARCHAR(4), p_quarter VARCHAR(10), p_row_score INT, p_col_score INT` | `BOOLEAN` |
| `verify_host_pin`     | `p_party_code VARCHAR(6), p_pin VARCHAR(4)`                                                  | `BOOLEAN` |
| `delete_party`        | `p_party_id UUID, p_pin VARCHAR(4)`                                                          | `BOOLEAN` |

## BroadcastMessage Wire Protocol

`BroadcastMessage.type` string values (`claim_intent`, `claim_rejected`, `unclaim_intent`) are sent over the wire between browser clients. Changing a value on one side silently breaks the other with NO TypeScript error. Treat these strings as a wire protocol contract — document any change here and update ALL clients simultaneously.

## Do NOT Rules

- Never modify existing SQL migration files (create new ones)
- Never rename exported stores/functions from game.ts (26+ exports, every component depends on them)
- Never convert stores from `writable()`/`derived()` to runes
- Never change the `.then()` pattern in optimistic functions to `await`
- Never change CSS variable names in app.css
- Never set `player_name_lower` directly — it's auto-generated
- Never change BroadcastMessage.type string values without updating all clients

## Testing

All changes must pass `npm run test && npm run check && npm run lint`. Test files mirror source under `src/tests/`. See `src/tests/setup.ts` for available mocks.

Exported mocks from setup.ts: `mockSupabaseClient`, `mockSupabaseChannel`, `mockChannelHandlers`, `localStorageMock`, `sessionStorageMock`.

Factory functions in test files: `createMockParty()`, `createMockSquare()`, `createEmptyGrid()`.

## Known Issues

See `security-todo.md`.
