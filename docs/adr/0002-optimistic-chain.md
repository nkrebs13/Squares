# ADR-0002: Optimistic update chain uses `.then()` (non-blocking) — never `await`

**Status:** Accepted (2026-01)

## Context

When a user taps a square to claim it, the perceived latency until they see "their square" matters. A naive implementation:

```ts
async function claim(row, col) {
  const { error } = await supabase.rpc('claim_square', { ... });
  if (!error) {
    squares.update(...);  // local UI updates AFTER server confirms
  }
}
```

…has 200–500ms of dead UI between tap and visible state change. That's enough for a user to second-guess whether their tap registered, double-tap, or get frustrated. On contested cells with multiple users tapping simultaneously, the latency window also lets two users feel like they "got" the same square — only to see one disappear when the server resolves.

We want **the local UI to update on tap**, with the server confirming or rolling back asynchronously. This is the "optimistic UI" pattern.

## Decision

The optimistic claim/unclaim/batch-claim functions in `src/lib/stores/game-optimistic.ts` use **`.then()`** on the Supabase RPC call, NOT `await`, and the function returns immediately after the optimistic update.

```ts
export function claimSquareOptimistic(row: number, col: number): void {
  // 1. Add pending op (rollback target)
  // 2. Update local store (optimistic — user sees their square instantly)
  // 3. Broadcast intent to other clients
  // 4. Schedule timeout (rollback if no postgres_changes confirms in 10s)

  // 5. Fire RPC NON-BLOCKING — function returns here
  supabase
    .rpc('claim_square', { ... })
    .then(({ error }) => {
      if (error) {
        // 8. Rollback: restore originalState, broadcast claim_rejected, toast
      }
      // 7. Success path is implicit — postgres_changes UPDATE clears the
      //    pending op via applySquareUpdate (in game-realtime.ts -> game-state.ts).
    });
}
```

The function signature returns `void` instead of `Promise<boolean>` so callers physically cannot `await` it.

## Consequences

### What this gets right

1. **Instant feedback.** Tap → square colored as yours, in the next frame. The 200–500ms RPC latency is invisible.
2. **Race resolution by Postgres.** Two clients claiming the same cell both see the optimistic update. The first one wins via the unique constraint; the second's RPC errors and rolls back. The user briefly sees themselves as the owner, then sees the other player's name. UX-acceptable for the rare race.
3. **Broadcast supplements postgres_changes.** Client B sees client A's `claim_intent` within ~50ms of A's tap (vs 200–500ms for the postgres_changes round-trip). Client B optimistically renders "Alice is claiming…" and then resolves when postgres_changes arrives.
4. **Timeout safety net.** If the RPC succeeds but postgres_changes drops, the 10-second timeout still rolls back the pending op so the UI stays consistent.

### What this costs

1. **Cognitive load.** A reader scanning the function body has to know that the absence of `await` is intentional. The function-level doc comment now spells out all 8 steps including this one to prevent drive-by `await` "fixes."
2. **Error toasts arrive late.** If the RPC fails, the user has already seen the optimistic claim for ~300ms. The rollback + error toast feels like a step backward. Acceptable cost — the alternative (no optimistic update) makes the common path slow for the failure-case rare.
3. **Test complexity.** Tests for the optimistic path can't `await` the function; they have to await the next microtask + the .then() callback to assert the rollback path. The test suite uses `vi.runAllTimersAsync()` and explicit `await Promise.resolve()` flushes.

### What we explicitly do NOT do

- **No "await with rollback".** Some codebases use `try { await rpc() } catch { rollback }`. That blocks the function for the RPC duration, defeating the point.
- **No retry inside the .then().** A failed RPC means "you can't have this square." Retrying would just confuse the user (e.g., they get `claim_intent` rolled back, then suddenly the claim succeeds 2s later).
- **No suspending UI on the pending state.** The square is rendered as claimed-by-you for the entire optimistic window. The pending op is invisible to the user; only used internally for rollback.

## References

- `src/lib/stores/game-optimistic.ts` — the function with the inline 8-step doc comment
- `CLAUDE.md` — "Optimistic Update Chain (do not alter)" rules
- `src/tests/stores/game-optimistic.test.ts` — tests demonstrating the rollback path
- ADR-0003 (dual realtime channels) — explains why broadcast supplements postgres_changes
