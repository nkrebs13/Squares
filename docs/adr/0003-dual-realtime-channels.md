# ADR-0003: Dual realtime channels — broadcast for speed, postgres_changes for truth

**Status:** Accepted (2026-01)

## Context

When a user claims a square, every other browser viewing the same party should see the change. Supabase Realtime offers two transports:

- **`postgres_changes`** subscribes to row-level INSERT/UPDATE/DELETE events on a table. Authoritative — fires only after the DB commits the change.
- **Broadcast channels** push arbitrary JSON between connected clients. Client-to-client; the server is just a relay. Lower latency (~50ms) but lossy and unauthenticated.

Our latency budget for "Alice tapped (3,7)" → "Bob's screen shows it" is ~100ms to feel real-time. postgres_changes alone runs ~200–500ms (RPC → DB commit → realtime fanout → Bob's client). Broadcast alone runs ~50ms but a missed message means Bob's grid is wrong until next page load.

## Decision

`subscribeToParty()` in `src/lib/stores/game-realtime.ts` opens **both** channels for every party page:

```ts
function subscribeToParty(partyId: string, gameId: string | null) {
	setupBroadcastChannel(partyId); // party-broadcast:<id>
	setupPartyChannel(partyId); // party:<id> with postgres_changes
	if (gameId) setupGameChannel(gameId); // live ESPN scores
}
```

**Broadcast handles the optimistic preview**, postgres_changes is the source of truth. Both update the same `squares` store. If they conflict, postgres_changes (which arrives later) wins.

## Consequences

### Why we run both

1. **Broadcast lets Alice's tap show on Bob's grid in ~50ms.** `claim_intent` flies between clients before the DB even commits. Bob's grid updates optimistically — his squares store gets `(3,7)` set to "Alice" with a pending-op marker.

2. **postgres_changes confirms within ~300ms.** When Alice's RPC commits, Bob's `applySquareUpdate` clears the pending op and locks in the confirmed state. If Alice's RPC failed (cell race-claimed by someone else), Alice broadcasts `claim_rejected` and Bob's pending op rolls back.

3. **postgres_changes alone would be too slow** — Bob would see his own taps instantly (his local optimistic update from ADR-0002) but Alice's taps with a 200–500ms delay. The asymmetry is visually jarring. Broadcast eliminates it.

4. **Broadcast alone would be too lossy** — a single dropped `claim_intent` leaves Bob's grid showing the cell as unclaimed forever. postgres_changes guarantees eventual consistency.

### What this costs

1. **Two channels per page = 2x the realtime connection budget.** Supabase free tier allows 200 concurrent realtime connections. Our usage estimate: 50 concurrent parties × 5 viewers × 2 channels = 500 connections, exceeding free tier under heavy load. Acceptable for portfolio traffic; would need to upgrade or share the broadcast channel across parties for production scale.

2. **Resolution complexity.** Three sources of truth update the same `squares` store: local optimistic (instant), broadcast (~50ms), postgres_changes (~300ms). The pending-operations Map keys by `row-col` and serializes resolution. Documented inline in `game-optimistic.ts` and `game-realtime.ts`.

3. **Testing surface area is bigger.** Each handler in `game-realtime.ts` has its own test cases for the four event types per table (INSERT/UPDATE/DELETE/?). Mitigated by the `apply*` extraction in Phase 5 — tests can call `applySquareUpdate(payload)` directly without staging a full channel subscription.

### Failure modes and how we handle them

| Scenario                                          | What happens                                                                                                                                                       | Mitigation                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Broadcast dropped, postgres_changes works         | Bob sees Alice's claim ~300ms late instead of ~50ms                                                                                                                | UX degradation only; correctness preserved                                    |
| postgres_changes drops while broadcast works      | Alice's `claim_intent` shows on Bob's grid as pending. After 10s, the timeout rolls it back to "unclaimed" because no postgres_changes confirmed it                | Page reload corrects; banner from Phase 1.5 alerts after 5 reconnect failures |
| Both channels drop                                | Bob's connectionStatus store flips to 'reconnecting' then 'failed'; banner offers refresh                                                                          | Surfaced via ConnectionBanner                                                 |
| Two clients tap same cell within broadcast window | Both render the cell as their own optimistically; postgres_changes from the winning RPC corrects the loser; loser's RPC errors and rolls back via `claim_rejected` | Documented in ADR-0002                                                        |

## What we considered and rejected

- **postgres_changes only.** Too slow for the optimistic UX. Users tap-tap-tapping on a cell that "looks unclaimed" because Alice's `claim_intent` hasn't propagated.
- **Broadcast only.** Lossy. One dropped message = inconsistent state forever (until full reload).
- **Server-side websocket fan-out (custom edge function).** Could be faster than postgres_changes alone, but Supabase already provides the building blocks. Adding a custom server is more code, more failure surface, more deployment complexity.
- **Polling.** Even at 1Hz the UX feels worse and the bandwidth is higher than realtime channels.

## References

- `src/lib/stores/game-realtime.ts` — `subscribeToParty`, `setupBroadcastChannel`, `setupPartyChannel`
- `src/lib/stores/game-state.ts` — `apply*` functions called by both channel paths
- ADR-0002 (optimistic chain) — explains the local-update path that broadcast supplements
- `src/lib/components/ConnectionBanner.svelte` — surfaces channel-failure states to the user
