# Football Squares

## Project Overview

Football Squares — a real-time Super Bowl squares pool app. SvelteKit 5, Supabase (Postgres + Realtime), Tailwind 4, deployed on Cloudflare Pages. Production app, Super Bowl Sunday usage expected.

## CRITICAL: Hybrid Reactivity Model

- **STORES** (`src/lib/stores/*.ts`) use **legacy Svelte stores**: `writable()`, `derived()`, `get()` from `svelte/store` — **DO NOT convert to runes**
- **COMPONENTS** (`src/lib/components/*.svelte`) use **Svelte 5 runes**: `$state()`, `$derived()`, `$effect()`, `$props()` — **DO NOT use legacy `$:` syntax**
- Routes use runes for reactive params

## Brand Config

- Brand strings (app name, tagline, OG description), default team labels/colors, and currency code/locale live in `src/lib/config.ts` (`APP_CONFIG`).
- Each value reads a `PUBLIC_*` env var via `$env/dynamic/public` with a hardcoded fallback that preserves the current Football Squares experience.
- `DEFAULT_TEAMS` is exported from `$lib/config`. `$lib/types` re-exports it for backwards compatibility, but new imports should source from `$lib/config` directly.
- `vite.config.ts` reads `process.env.PUBLIC_APP_NAME` / `PUBLIC_APP_DESCRIPTION` at build time so the PWA manifest stays in sync.
- When adding new brand-aware UI strings or defaults, extend `APP_CONFIG` rather than hardcoding in components.

## Architecture Quick Reference

- **Create flow**: `src/routes/create/+page.svelte` collects form state and calls `src/lib/services/createParty.ts`, which invokes the single transactional `host_create_party` RPC (migration 036). Inserts the party, 100 squares, and the scores row atomically — no client-side rollback needed. The client always sends the event name and teams (`APP_CONFIG` defaults via `eventNameOrDefault` / `DEFAULT_TEAMS`); the server stores no brand defaults of its own.
- **Game flow**: `src/lib/stores/game.ts` → RPCs + Realtime subscriptions
- **Pending-op state**: `src/lib/stores/game-pending.ts` owns `pendingOperations` and each op's whole life: `newPendingOp`, `addPendingOps` (with the 10s timeout), `rollbackPendingOpIf`, `applySquareUpdate`, `clearPendingOps`. Store import direction is `game-state` ← `game-pending` ← `game-realtime` ← `game-optimistic`; `game-pending` must never import from the latter two. `game-optimistic.ts` runs the chain below through `begin` / `reject`.
- **Store module map** (all re-exported through the `game.ts` facade): `game-load.ts` owns `loadParty`: one `get_party_state` call (migration 039) fills every party store; it imports `game-state` only (never the reverse). Team ↔ game matching lives only in SQL (`game_side`); the client reads the result (`gameHomeIsRow`) and never re-derives it. `game-admin.ts` and `services/createParty.ts` call `host_*` RPCs through `callHost` in `src/lib/services/hostAction.ts`, which maps refusal codes (and the `field` of `invalid_input`) to copy; a transport failure gets the call site's `failed` copy. `game-realtime.ts` tears channels down only via `teardownChannels()` (bump `currentGeneration` first). Console diagnostics go through `logWarn` / `logError` in `src/lib/utils/log.ts` (the one `no-console` disable; sole exception: the guarded `warn()` in `validators/realtime.ts`). Full direction: `game-state` ← `game-load`; `game-state` ← `game-pending` ← `game-realtime` ← `game-optimistic`; `game-admin` sits on top.
- **Constants and join preview**: `src/lib/constants.ts` is the single home for domain limits (`GRID_SIZE`, `TOTAL_SQUARES`, `PIN_LENGTH`, `MAX_PIN_ATTEMPTS`, `MAX_NAME_LENGTH` (20, see UI/DB asymmetry below), `MAX_NICKNAME_LENGTH`, `MAX_EVENT_NAME_LENGTH`) — import from there instead of hardcoding 10/100/4/20. `src/lib/services/partyPreview.ts` owns the join page's Supabase reads (`fetchPartyPreview`, `fetchJoinTarget`).
- **Dual Realtime channels**: `subscribeToParty()` creates a broadcast channel (fast optimistic updates) AND a postgres_changes channel (5 tables: squares, parties, numbers, scores, winners). postgres_changes is source of truth.

### Optimistic Update Chain (do not alter)

Implemented once in `game-optimistic.ts` (`claimCells` for a tap or a drag, `unclaimSquareOptimistic`), with op lifecycle in `game-pending.ts`.

1. User action → `claimSquareOptimistic()` / `claimSquaresBatchOptimistic()` (both `claimCells`) or `unclaimSquareOptimistic()`
2. Pending ops added to `pendingOperations` (keyed `row-col`, see `utils/squareKey.ts`), each with a 10,000ms timeout
3. Local `squares` store updated immediately
4. Intent broadcast via Supabase Realtime broadcast channel
5. **RPC fires via `.then()` pattern (non-blocking, NOT `await`)** — intentional, do not "improve" to await. Claims call `claim_squares` with the set of cells.
6. On success: `postgres_changes` calls `applySquareUpdate` (in `game-pending.ts`), which clears the pending op and its timeout
7. On refusal or error: the op rolls back (to the owner `claim_squares` reports in `taken`, else to `originalState`), the rejection is broadcast, and the user sees a toast. Every exit clears the op's timer.

Ops carry `origin: 'local' | 'remote'` and the sending tab's `clientId`; a remote op (another tab's previewed intent) is rolled back only by that tab's rejection or silently by its timeout. The player filter in effect is `activePlayerFilter` (the picked player while they hold a square), so rollbacks never touch it.

### State Machine

`filling` → `active` → `complete`

The `locked` status exists in the DB CHECK constraint and frontend rendering but is never set by current RPCs — `lock_party` jumps directly to `active`. Do NOT remove `locked` from the type or frontend.

## Database Constraints

- Current schema and RPC bodies: read `supabase/schema.snapshot.sql` (generated, never hand-edit). Regenerate after every new migration with `npm run db:snapshot` (needs local Supabase running).

- `player_name_lower` is `GENERATED ALWAYS AS (LOWER(player_name)) STORED` — never set directly in INSERT/UPDATE, only set `player_name`
- Splits CHECK: `split_q1 + split_q2 + split_q3 + split_final = 100`
- Winners UNIQUE on `(party_id, quarter)`
- Functions in `public` are private by default (migration 034). A function is client API only when a migration `GRANT EXECUTE ... TO anon, authenticated` it and it is listed in `CLIENT_API` in `src/tests/integration/function-grants.test.ts`. Internal helpers (`check_pin_lockout`, `auto_update_score`, trigger functions, ...) get no grant.
- Live games: a party is auto-scored only through its stored `game_id` (set out of band; 73 production parties were linked to the 2026 Super Bowl that way). `get_party_state` also returns an unlinked matching game, flagged `linked: false`; that one is display-only and never scored. `parties.home_team_is_row` is kept by the `parties_home_team_side` trigger (`game_side`).
- `push_subscriptions` has no anon table access; browsers subscribe only through `save_push_subscription`.

## UI / DB Constraint Asymmetry

UI inputs bound to `player_name` (and `host_name`) use `maxlength="20"` for grid legibility — names must fit inside 28-44 px square cells. The DB column is sized `VARCHAR(50)` to absorb larger inputs that may arrive via the SQL editor or admin CLI without requiring a column-widen migration. The asymmetry is intentional, not a bug.

## Host Actions (`host_*` RPCs, migrations 035–037)

Every host action is a `host_*` function; the PIN-gated ones start with `host_gate(party_id, pin, action, required_status)`. Each returns `{ok: true, ...}` or `{ok: false, error, field?}`. Refusal codes: `not_found`, `invalid_pin`, `locked_out`, `wrong_status`, `grid_incomplete`, `invalid_input` (with `field`). Validation is shared: `party_details_problem`, `splits_valid`, `party_expiry`. Scoring has one path, `record_quarter_score`, used by `host_record_score` and the live `game_scores` trigger (`auto_update_score`); it RAISEs when the winning square has no owner so the score never lands without a winner, and the trigger contains that per party. The client maps codes to copy in one place (`src/lib/services/hostAction.ts`, plus per-action overrides); it never matches on error text for these RPCs.

| RPC                   | Parameters                                                                                                                                                        | `ok: true` payload           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `host_create_party`   | `p_host_name, p_pin, p_square_price, p_split_q1..p_split_final, p_team_row_name, p_team_col_name, p_team_row_color, p_team_col_color, p_event_name, p_kickoff_at` | `party`                      |
| `host_verify_pin`     | `p_party_code VARCHAR(6), p_pin VARCHAR(4)`                                                                                                                       | —                            |
| `host_lock_party`     | `p_party_id UUID, p_pin VARCHAR(4)`                                                                                                                               | `party`, `numbers`           |
| `host_delete_party`   | `p_party_id UUID, p_pin VARCHAR(4)`                                                                                                                               | —                            |
| `host_remove_player`  | `p_party_id UUID, p_pin VARCHAR(4), p_player_name VARCHAR(50)`                                                                                                    | `removed` (count)            |
| `host_update_payouts` | `p_party_id UUID, p_pin VARCHAR(4), p_split_q1..p_split_final INT`                                                                                                | `party`                      |
| `host_update_details` | `p_party_id, p_pin, p_event_name, p_kickoff_at, p_team_row_name, p_team_col_name, p_team_row_color, p_team_col_color`                                             | `party`                      |
| `host_record_score`   | `p_party_id, p_pin, p_quarter ('q1'\|'q2'\|'q3'\|'final'), p_row_score, p_col_score`                                                                              | `party`, `scores`, `winners` |

The older `claim_square`, `claim_squares_batch`, `create_party`, `update_party_details`, `update_score`, `verify_host_pin`, `lock_party`, `delete_party`, `remove_player` and `update_payout_structure` remain only for clients still running an older bundle; the app no longer calls them, and a later migration drops them.

## RPC Signatures

| RPC                       | Parameters                                                                                                                                                                                                  | Returns                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `create_party`            | `p_host_name VARCHAR(50), p_pin VARCHAR(4), p_square_price DECIMAL, p_split_q1 INT, p_split_q2 INT, p_split_q3 INT, p_split_final INT, [team overrides]`                                                    | `parties` row                                                                                    |
| `claim_square`            | `p_party_id UUID, p_row INT, p_col INT, p_player_name VARCHAR(50)`                                                                                                                                          | `BOOLEAN`                                                                                        |
| `unclaim_square`          | same pattern                                                                                                                                                                                                | `BOOLEAN`                                                                                        |
| `claim_squares_batch`     | `p_party_id UUID, p_player_name VARCHAR(50), p_cells JSONB`                                                                                                                                                 | `INTEGER`                                                                                        |
| `claim_squares`           | `p_party_id UUID, p_player_name VARCHAR(50), p_cells JSONB` (`[{row, col}]`, 1–100 cells)                                                                                                                   | `{ok, claimed: [{row,col}], taken: [{row,col,player_name}]}` or `{ok: false, error}`             |
| `lock_party`              | `p_party_id UUID, p_pin VARCHAR(4)`                                                                                                                                                                         | `BOOLEAN`                                                                                        |
| `update_score`            | `p_party_id UUID, p_pin VARCHAR(4), p_quarter VARCHAR(10), p_row_score INT, p_col_score INT`                                                                                                                | `BOOLEAN`                                                                                        |
| `verify_host_pin`         | `p_party_code VARCHAR(6), p_pin VARCHAR(4)`                                                                                                                                                                 | `BOOLEAN`                                                                                        |
| `get_party_state`         | `p_code TEXT`                                                                                                                                                                                               | `{party, squares, numbers, scores, winners, game: {row, home_is_row, linked} \| null}` or `NULL` |
| `save_push_subscription`  | `p_party_id UUID, p_player_name VARCHAR(50), p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT`                                                                                                                   | `BOOLEAN` — FALSE when the name holds no square in the party                                     |
| `delete_party`            | `p_party_id UUID, p_pin VARCHAR(4)`                                                                                                                                                                         | `BOOLEAN`                                                                                        |
| `update_party_details`    | `p_party_id UUID, p_pin VARCHAR(4), p_event_name VARCHAR(80), p_kickoff_at TIMESTAMPTZ, p_team_row_name VARCHAR(50), p_team_col_name VARCHAR(50), p_team_row_color VARCHAR(7), p_team_col_color VARCHAR(7)` | `parties` row — **NULL sentinel on PIN failure** (migration 033), not RAISE                      |
| `update_payout_structure` | `p_party_id UUID, p_pin VARCHAR(4), p_split_q1 INT, p_split_q2 INT, p_split_q3 INT, p_split_final INT`                                                                                                      | `parties` row — **NULL sentinel on PIN failure** (migration 033), not RAISE                      |
| `remove_player`           | `p_party_id UUID, p_pin VARCHAR(4), p_player_name_lower VARCHAR(50)`                                                                                                                                        | `INTEGER` (removed count) — **NULL sentinel on PIN failure** (migration 033), not RAISE          |

## BroadcastMessage Wire Protocol

`BroadcastMessage.type` string values (`claim_intent`, `claim_rejected`, `unclaim_intent`, `unclaim_rejected`) are sent over the wire between browser clients. Changing a value on one side silently breaks the other with NO TypeScript error. Treat these strings as a wire protocol contract — document any change here and update ALL clients simultaneously.

- `unclaim_rejected` (added): sent by an unclaiming client when its `unclaim_square` RPC is rejected (error OR a BOOLEAN `false` domain rejection — see migration 029). Observers that optimistically cleared the square on the matching `unclaim_intent` restore it. Adding a new type is backward-compatible: `handleBroadcastMessage` dispatches with an if/else-if chain, so an older client receiving an unknown type simply no-ops (never throws). New types may be added additively; never change or remove an existing value.

## Do NOT Rules

- Never modify existing SQL migration files (create new ones)
- Never rename exported stores/functions from game.ts (26+ exports, every component depends on them)
- Never convert stores from `writable()`/`derived()` to runes
- Never change the `.then()` pattern in optimistic functions to `await`
- Never change CSS variable names in app.css
- Never set `player_name_lower` directly — it's auto-generated
- Never change BroadcastMessage.type string values without updating all clients
- Never `RAISE` on a PIN/lockout failure in any host action — return the refusal (`host_refusal(...)` in `host_*` functions, the `NULL` sentinel in the legacy `update_party_details`, `update_payout_structure`, `remove_player`). PostgREST runs each RPC as ONE transaction, so a `RAISE` rolls back `check_pin_lockout`'s own `pin_attempts` increment, silently stopping the brute-force throttle and reopening a 10,000-PIN oracle (migration 033). Refusals the host can act on (status, input) also return a code; `RAISE` is only for integrity faults that should roll the call back.

## Testing

All changes must pass `npm run test && npm run check && npm run lint`. Test files mirror source under `src/tests/`. See `src/tests/setup.ts` for available mocks.

Exported mocks from setup.ts: `mockSupabaseClient`, `mockSupabaseChannel`, `mockChannelHandlers`, `localStorageMock`, `sessionStorageMock`.

Factory functions in test files: `createMockParty()`, `createMockSquare()`, `createEmptyGrid()`.
