# Football Squares

## Project Overview

Football Squares — a real-time Super Bowl squares pool app. SvelteKit 5, Supabase (Postgres + Realtime), Tailwind 4, deployed on Cloudflare Pages. Production app, Super Bowl Sunday usage expected.

## CRITICAL: Hybrid Reactivity Model

- **STORES** (`src/lib/stores/*.ts`) use **legacy Svelte stores**: `writable()`, `derived()`, `get()` from `svelte/store` — **DO NOT convert to runes**
- **COMPONENTS** (`src/lib/components/*.svelte`) use **Svelte 5 runes**: `$state()`, `$derived()`, `$effect()`, `$props()` — **DO NOT use legacy `$:` syntax**
- Routes use runes for reactive params

## Architecture Quick Reference

- **Create flow**: `src/routes/create/+page.svelte` collects form state and calls `src/lib/services/createParty.ts`, which invokes the single transactional `create_party` RPC (migration 023). Inserts the party, 100 squares, and the scores row atomically — no client-side rollback needed.
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

## Database Constraints

- `player_name_lower` is `GENERATED ALWAYS AS (LOWER(player_name)) STORED` — never set directly in INSERT/UPDATE, only set `player_name`
- Splits CHECK: `split_q1 + split_q2 + split_q3 + split_final = 100`
- Winners UNIQUE on `(party_id, quarter)`

## UI / DB Constraint Asymmetry

UI inputs bound to `player_name` (and `host_name`) use `maxlength="20"` for grid legibility — names must fit inside 28-44 px square cells. The DB column is sized `VARCHAR(50)` to absorb larger inputs that may arrive via the SQL editor or admin CLI without requiring a column-widen migration. The asymmetry is intentional, not a bug.

## RPC Signatures

| RPC                   | Parameters                                                                                                                                               | Returns       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `create_party`        | `p_host_name VARCHAR(50), p_pin VARCHAR(4), p_square_price DECIMAL, p_split_q1 INT, p_split_q2 INT, p_split_q3 INT, p_split_final INT, [team overrides]` | `parties` row |
| `claim_square`        | `p_party_id UUID, p_row INT, p_col INT, p_player_name VARCHAR(50)`                                                                                       | `BOOLEAN`     |
| `unclaim_square`      | same pattern                                                                                                                                             | `BOOLEAN`     |
| `claim_squares_batch` | `p_party_id UUID, p_player_name VARCHAR(50), p_cells JSONB`                                                                                              | `INTEGER`     |
| `lock_party`          | `p_party_id UUID, p_pin VARCHAR(4)`                                                                                                                      | `BOOLEAN`     |
| `update_score`        | `p_party_id UUID, p_pin VARCHAR(4), p_quarter VARCHAR(10), p_row_score INT, p_col_score INT`                                                             | `BOOLEAN`     |
| `verify_host_pin`     | `p_party_code VARCHAR(6), p_pin VARCHAR(4)`                                                                                                              | `BOOLEAN`     |
| `delete_party`        | `p_party_id UUID, p_pin VARCHAR(4)`                                                                                                                      | `BOOLEAN`     |

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
