# ADR-0001: Hybrid reactivity — legacy stores in `lib/stores`, runes in components

**Status:** Accepted (2026-01)

## Context

Svelte 5 introduced runes (`$state`, `$derived`, `$effect`, `$props`) as a new reactivity primitive intended to eventually replace the legacy store API (`writable`, `derived`, `get`). The migration story is "use both, eventually move everything to runes."

This codebase has ~300 lines of cross-component shared state — `party`, `squares`, `numbers`, `scores`, `winners`, `gameScores`, `pendingOperations`, `selectedPlayerFilter`, plus derived stores like `mySquares`, `playerSummary`, `liveScores`, `leadingSquare`. That state is consumed by 12+ components and mutated by the realtime transport layer (a non-component module).

The question: should we use runes everywhere (the future direction) or keep stores for shared state and use runes only in components?

## Decision

**Stores stay on `writable()` / `derived()`. Components use runes. Routes use runes for reactive params.**

The split is enforced by convention and called out in `CLAUDE.md`:

- `src/lib/stores/*.ts` — **legacy stores only.** No `$state`, no `$derived` in store files.
- `src/lib/components/*.svelte` — **runes only.** No `$:` reactive declarations, no `let count` for state.
- `src/routes/**/*.svelte` — **runes** for reactive params and local state.

## Consequences

### Why this works for our shape

1. **Stores are mutated from non-component code.** `game-realtime.ts` is a plain `.ts` module — it can't host runes (runes require Svelte's compiler context). It needs imperative `.set()` / `.update()` from outside a component, which legacy stores provide and runes do not.

2. **Auto-subscription syntax (`$store`) is excellent in templates.** Components that read 6 stores get 6 `$` prefixes and zero subscription bookkeeping. The equivalent rune approach (`$state` shared via context or imports) has more ceremony and re-renders less granularly across multiple subscribers.

3. **`derived` chains are simpler than `$derived` across files.** `liveScores` depends on `gameScores + party`. `leadingSquare` depends on `liveScores + numbers + party`. Modeling that with runes across module boundaries is awkward; with `derived` it's a single composable expression.

### Costs we accept

1. **Two reactivity mental models** — contributors need to internalize that the boundary is `lib/stores/*.ts` vs everything else. Mitigated by `CLAUDE.md` explicit rule + lint discipline.

2. **Cannot easily migrate to "all runes"** later without rewriting transport-layer mutations. We're betting that the legacy store API stays supported indefinitely (Svelte team has committed to this).

3. **Risk of drift** — a contributor adds `$state` to a store file or `let count` to a component. Caught in code review; would benefit from a custom lint rule but doesn't have one yet.

### What we considered and rejected

- **All runes via `$state` + `getContext`.** Forces every store consumer through a context provider; doesn't work for non-component code paths (game-realtime.ts).
- **All runes via `$state` exported from a `.svelte.ts` file.** Workable but the multi-subscriber re-render behavior is less optimized than `writable()` for our access patterns (12+ components subscribing to `squares`).
- **Wait until the ecosystem stabilizes.** The codebase ships now. Deferring the call would mean writing inconsistent code in the meantime.

## References

- `CLAUDE.md` — "CRITICAL: Hybrid Reactivity Model" section
- Svelte 5 docs on runes vs stores: https://svelte.dev/docs/svelte/runes
- `src/lib/stores/game-state.ts` — exemplar legacy-store file
- `src/lib/components/SimpleGrid.svelte` — exemplar runes-only component
