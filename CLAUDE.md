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
- `DEFAULT_TEAMS` is exported from `$lib/config`.
- `vite.config.ts` reads `process.env.PUBLIC_APP_NAME` / `PUBLIC_APP_DESCRIPTION` at build time so the PWA manifest stays in sync.
- When adding new brand-aware UI strings or defaults, extend `APP_CONFIG` rather than hardcoding in components.

## Architecture Quick Reference

- **Create flow**: `src/routes/create/+page.svelte` collects form state and calls `src/lib/services/createParty.ts`, which invokes the single transactional `host_create_party` RPC (migration 036). Inserts the party, 100 squares, and the scores row atomically — no client-side rollback needed. The client always sends the event name and teams (`APP_CONFIG` defaults via `eventNameOrDefault` / `DEFAULT_TEAMS`); the server stores no brand defaults of its own.
- **Game flow**: `src/lib/stores/game.ts` → RPCs + Realtime subscriptions
- **Pending-op state**: `src/lib/stores/game-pending.ts` owns `pendingOperations` and each op's whole life: `newPendingOp`, `addPendingOps` (with the 10s timeout), `rollbackPendingOpIf`, `applySquareUpdate`, `clearPendingOps`. Store import direction is `game-state` ← `game-pending` ← `game-realtime` ← `game-optimistic`; `game-pending` must never import from the latter two. `game-optimistic.ts` runs the chain below through `begin` / `reject`.
- **Store module map** (all re-exported through the `game.ts` facade): `game-load.ts` owns `loadParty`: one `get_party_state` call (migration 039) fills every party store; it imports `game-state` only (never the reverse). Team ↔ game matching lives only in SQL (`game_side`); the client reads the result (`gameHomeIsRow`) and never re-derives it. `game-admin.ts` and `services/createParty.ts` call `host_*` RPCs through `callHost` in `src/lib/services/hostAction.ts`, which maps refusal codes (and the `field` of `invalid_input`) to copy from `hostCopy.ts` (pure, so the integration tests check every refused field has copy); a transport failure gets the call site's `failed` copy. Per-party stores in `game-state.ts` are created with `resettable()`; `cleanup()` resets all of them through `resetPartyState()`, so a new store needs no cleanup edit. Team names/colours are `teamTheme`, derived from `party`; the party and admin pages set `--team-row-color` / `--team-col-color` on their own root, never on `document`. Browser online/offline lives in `stores/connectivity.ts`. The party page heals itself (`game-session.ts`): it re-reads the party (`get_party_state`) each time the party's postgres_changes channel joins (first subscribe and every rejoin, via `subscribeToParty`'s callback), when the tab becomes visible, and every `PARTY_REFRESH_MS` (60 s) while visible and no claim is in flight, because Realtime can drop events while the socket looks fine. Host actions (`game-admin.ts`) apply their result only while the party they started on is still shown (`stillShowing`). `game-realtime.ts` tears channels down only via `teardownChannels()` (bump `currentGeneration` first), except `followGame`, which re-keys the game channel alone (bumping its instance token) so the party's channels stay joined; `openParty` uses it for a linked game and for an unlinked party's detected game. Console diagnostics go through `logWarn` / `logError` in `src/lib/utils/log.ts` (the one `no-console` disable; sole exception: the guarded `warn()` in `validators/realtime.ts`). Full direction: `game-state` ← `game-load`; `game-state` ← `game-pending` ← `game-realtime` ← `game-optimistic`; `game-admin` sits on top.
- **Constants and join preview**: `src/lib/constants.ts` is the single home for domain limits (`GRID_SIZE`, `TOTAL_SQUARES`, `PIN_LENGTH`, `MAX_NAME_LENGTH` (20, see UI/DB asymmetry below), `MAX_NICKNAME_LENGTH`, `MAX_EVENT_NAME_LENGTH`) — import from there instead of hardcoding 10/100/4/20. Quarters (keys, labels, score lookup, next/latest quarter) live in `src/lib/quarters.ts`; party-status checks (`isFilling`, `isGameInProgress`, `hasDrawnNumbers`, `statusLabel`) in `src/lib/partyStatus.ts`; `formatMatchup` in `utils/format.ts`; `joinPath` in `utils/partyCode.ts`. Don't compare status strings or list quarters inline. `src/lib/services/partyPreview.ts` owns the join page's one read, `fetchPartyPreview` (`get_party_preview`, migration 040), used for both the preview and the host-name check; the party page's server load uses the same RPC for share metadata.
- **Browser persistence by feature**: `src/lib/storage.ts` holds only primitives (`local`, `session`, `durable` = IndexedDB with a localStorage fallback) and `STORAGE_KEYS` (names users' browsers already hold; never rename). Host PINs: `src/lib/hostPin.ts` (`rememberHostPin` / `cachedHostPin` / `recallHostPin` / `forgetHostPin`). The host's name is PIN-protected in the client only: every way into a party (join form, `/party/<code>` link) asks `mayPlayAs` (`hostPin.ts`): only a browser holding this party's PIN (stored only after the server accepted it) may use the host's name. Recent parties and the create/join → party-page nickname handoff (`stageNickname`): `src/lib/recentParties.ts`. User name: `stores/user.ts`. Gesture hint: `GestureHint.svelte`.
- **One mount per layout**: the two-column party layout starts at `DESKTOP_LAYOUT_QUERY` (`src/lib/layout.ts`, Tailwind `lg`). UI that appears in only one layout is chosen with `new MediaQuery(DESKTOP_LAYOUT_QUERY)` in the component, never mounted twice and hidden by CSS: `PartySidebar` sits above the grid on mobile and in the `<aside>` on desktop, and `PlayerLegend` is `collapsible` under the grid on mobile and a titled card in the sidebar on desktop. Toasts: `stores/toast.ts` owns each toast's timer; `ToastContainer.svelte` only stacks and animates them.
- **Dual Realtime channels**: `subscribeToParty()` creates a broadcast channel (fast optimistic updates) AND a postgres_changes channel (5 tables: squares, parties, numbers, scores, winners). postgres_changes is source of truth.

### Optimistic Update Chain (do not alter)

Implemented once in `game-optimistic.ts` (`claimCells` for a tap or a drag, `unclaimSquareOptimistic`), with op lifecycle in `game-pending.ts`.

1. User action → `claimSquareOptimistic()` / `claimSquaresBatchOptimistic()` (both `claimCells`) or `unclaimSquareOptimistic()`
2. Pending ops added to `pendingOperations` (keyed `row-col`, see `utils/squareKey.ts`), each with a 10,000ms timeout
3. Local `squares` store updated immediately
4. Intent broadcast via Supabase Realtime broadcast channel
5. **RPC fires via `.then()` pattern (non-blocking, NOT `await`)** — intentional, do not "improve" to await. Claims call `claim_squares` with the set of cells.
6. On success: the RPC's own answer ends the op (`settlePendingOps` in `game-pending.ts`: `claim_squares` ok for the cells in `claimed`, `unclaim_square` true), leaving the square as drawn, so a saved claim never times out into "not saved" when its Realtime event is late or lost. The `postgres_changes` UPDATE then lands through `applySquareUpdate`, which also ends any op still pending for that square.
7. On refusal or error: the op rolls back (to the owner `claim_squares` reports in `taken`, else to `originalState`), the rejection is broadcast, and the user sees a toast. Every exit clears the op's timer.

Ops carry `origin: 'local' | 'remote'` and the sending tab's `clientId`; a remote op (another tab's previewed intent) is rolled back only by that tab's rejection or silently by its timeout. The player filter in effect is `activePlayerFilter` (the picked player while they hold a square), so rollbacks never touch it.

### State Machine

`filling` → `active` → `complete`

The `locked` status exists in the DB CHECK constraint and frontend rendering but is never set by current RPCs — `host_lock_party` jumps directly to `active`. Do NOT remove `locked` from the type or frontend.

## Database Constraints

- Current schema and RPC bodies: read `supabase/schema.snapshot.sql` (generated, never hand-edit). Regenerate after every new migration with `npm run db:snapshot` (needs local Supabase running).

- `player_name_lower` is `GENERATED ALWAYS AS (LOWER(player_name)) STORED` — never set directly in INSERT/UPDATE, only set `player_name`
- Splits CHECK: `split_q1 + split_q2 + split_q3 + split_final = 100`
- Winners UNIQUE on `(party_id, quarter)`
- Functions in `public` are private by default (migration 034). A function is client API only when a migration `GRANT EXECUTE ... TO anon, authenticated` it and it is listed in `CLIENT_API` in `src/tests/integration/function-grants.test.ts`. Internal helpers (`host_pin_check`, `auto_update_score`, trigger functions, ...) get no grant. Tables are private by default too (migration 042): browsers may only `SELECT` the tables in `CLIENT_READABLE_TABLES` (same test file) plus the column-granted `parties` columns Realtime needs; every write goes through a function.
- Live games: a party is auto-scored only through its stored `game_id` (set out of band; 73 production parties were linked to the 2026 Super Bowl that way). `get_party_state` also returns an unlinked matching game updated in the last 12 hours (migration 050; a trigger stamps `game_scores.updated_at`), flagged `linked: false`; that one is display-only and never scored. Nothing in this repo feeds `game_scores` (the last feed write was 2026-02-14), so live scores are dormant and manual scoring is the path. `backfill_party_scores(party_id)` is the service-role-only operator tool (no client grant) for a party linked to a game out of band: it reads the party's `game_id` row in `game_scores` and, for each quarter whose score is already recorded, maps home/away to row/col via `home_team_is_row` and applies it through `auto_update_score`; it does nothing for an unlinked party or a missing game. `parties.home_team_is_row` is kept by the `parties_home_team_side` trigger (`game_side`).

## UI / DB Constraint Asymmetry

UI inputs bound to `player_name` (and `host_name`) use `maxlength="20"` for grid legibility — names must fit inside 28-44 px square cells. The DB column is sized `VARCHAR(50)` to absorb larger inputs that may arrive via the SQL editor or admin CLI without requiring a column-widen migration. The asymmetry is intentional, not a bug.

Team names follow the same pattern: the UI input stops at `MAX_TEAM_NAME_LENGTH` (30, grid headers) while the DB accepts 1–50 (`DB_MAX_TEAM_NAME_LENGTH`). Refusal copy that states a DB limit (`hostCopy.ts` `INPUT_FIELD_COPY`) reads it from `src/lib/constants.ts` (`PIN_LENGTH`, `MAX_EVENT_NAME_LENGTH`, `DB_MAX_TEAM_NAME_LENGTH`, `MIN_SQUARE_PRICE`, `SQUARE_PRICE_CEILING`), so the numbers have one home.

## Host Actions (`host_*` RPCs, migrations 035–037)

Every host action is a `host_*` function; the PIN-gated ones start with `host_gate(party_id, pin, action, required_status)`. Each returns `{ok: true, ...}` or `{ok: false, error, field?}`. Refusal codes: `not_found`, `invalid_pin`, `locked_out`, `wrong_status`, `grid_incomplete`, `invalid_input` (with `field`). Validation is shared: `party_details_problem`, `splits_valid`, `party_expiry`. Scoring has one path, `record_quarter_score`, used by `host_record_score` and the live `game_scores` trigger (`auto_update_score`); it RAISEs when the winning square has no owner so the score never lands without a winner, and the trigger contains that per party. A complete party takes exactly one more score: a corrected final from its host (`host_record_score` passes `p_host_correction`); the live feed and `backfill_party_scores` never do, so they can't overwrite a host's correction (migration 050). A game's quarter scores reach a party only through `apply_game_scores` (migration 043), used by the live trigger and by `backfill_party_scores`, so the quarter list and the home/away → row/col rule live in one place. The client maps codes to copy in one place (`src/lib/services/hostCopy.ts`, plus per-action overrides); it never matches on error text for these RPCs.

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

The pre-035 RPCs these replaced (`create_party`, `lock_party`, `claim_square`, `update_score`, ...) were dropped in migration 041.

## RPC Signatures

| RPC                 | Parameters                                                                                | Returns                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `unclaim_square`    | `p_party_id UUID, p_row INT, p_col INT, p_player_name VARCHAR(50)`                        | `BOOLEAN`                                                                                        |
| `claim_squares`     | `p_party_id UUID, p_player_name VARCHAR(50), p_cells JSONB` (`[{row, col}]`, 1–100 cells) | `{ok, claimed: [{row,col}], taken: [{row,col,player_name}]}` or `{ok: false, error}`             |
| `get_party_preview` | `p_code TEXT`                                                                             | `{party, filled_count}` or `NULL`                                                                |
| `get_party_state`   | `p_code TEXT`                                                                             | `{party, squares, numbers, scores, winners, game: {row, home_is_row, linked} \| null}` or `NULL` |

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
- Never `RAISE` on a PIN/lockout failure in any host action — return the refusal (`host_refusal(...)`). PostgREST runs each RPC as ONE transaction, so a `RAISE` rolls back `host_pin_check`'s own `pin_attempts` increment, silently stopping the brute-force throttle and reopening a 10,000-PIN oracle (migration 033). Refusals the host can act on (status, input) also return a code; `RAISE` is only for integrity faults that should roll the call back.

## Testing

All changes must pass `npm run test && npm run check && npm run lint`. Test files mirror source under `src/tests/`. See `src/tests/setup.ts` for available mocks.

Exported mocks from setup.ts: `mockSupabaseClient`, `mockSupabaseChannel`, `mockChannelHandlers`, `localStorageMock`, `sessionStorageMock`.

Factory functions in test files: `createMockParty()`, `createMockSquare()`, `createEmptyGrid()`.
