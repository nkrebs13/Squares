Review all uncommitted changes (staged and unstaged) against this 8-item checklist. Report each item as PASS or FAIL with details.

Run `git diff` and `git diff --cached` to see all changes, then check:

1. **Store-to-rune conversion**: Stores in `src/lib/stores/` must use `writable()`/`derived()` from `svelte/store`, NOT `$state()` or `$derived()` runes
2. **Broken imports**: Check for missing or incorrect import paths in changed files
3. **player_name_lower set directly**: Must only set `player_name` — `player_name_lower` is a GENERATED ALWAYS column
4. **`.then()` changed to `await`**: Optimistic functions in game.ts must keep the `.then()` pattern (non-blocking RPC calls)
5. **Existing migration files modified**: Files in `supabase/migrations/` with existing numbers must NOT be changed — create new migration files instead
6. **CSS variable names changed**: CSS variables in `src/app.css` must not be renamed
7. **BroadcastMessage.type values changed**: The string values `claim_intent`, `claim_rejected`, `unclaim_intent` are a wire protocol — do not change
8. **Exported names changed in game.ts**: Do not rename any exported stores or functions from `src/lib/stores/game.ts`

This command does NOT run tests — use `/test` for that.
