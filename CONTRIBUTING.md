# Contributing

Thanks for your interest in Football Squares. This is a personal project but contributions are welcome.

By contributing, you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## Quick start

```bash
git clone https://github.com/nkrebs13/Squares.git
cd squares
npm install
cp .env.example .env.local
# Edit .env.local: at minimum set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

## Local Supabase (for integration / e2e tests)

The unit-test suite runs without Supabase via mocks. Integration and e2e tests need a local Supabase instance.

```bash
# One-time install:
brew install supabase/tap/supabase

# Per-session:
supabase start                # starts containers + applies migrations
npm run test:integration      # runs against http://127.0.0.1:54321
supabase stop                 # when done
```

### Seed data

Running `supabase db reset` applies all migrations and then automatically executes `supabase/seed.sql`. After reset, a demo party is available at `/party/DEMO01` (PIN: `0000`) with ~30 pre-claimed squares spread across four fictional players. This gives you a realistic grid to work against without needing to claim squares manually.

Tests use `createTestParty()` (defined in each test file's setup) with randomly-generated UUIDs. These never collide with the demo party's reserved UUID (`00000000-0000-0000-0000-000000000001`).

If you want to regenerate `src/lib/database.types.ts` from your local schema:

```bash
supabase start
npm run db:types
```

## Testing

| Command                    | What it runs                                             | When to use               |
| -------------------------- | -------------------------------------------------------- | ------------------------- |
| `npm run test`             | Unit tests (Vitest, jsdom)                               | After every change        |
| `npm run test:watch`       | Unit tests in watch mode                                 | While coding              |
| `npm run test:coverage`    | Unit + coverage report                                   | Before pushing            |
| `npm run test:integration` | Tests against local Supabase (requires `supabase start`) | When DB-related           |
| `npm run test:e2e`         | Playwright (Chromium + Mobile Chrome)                    | Before merging UI changes |

Coverage thresholds are enforced (`branches >= 81%`, `lines >= 93%`, etc.). See `vite.config.ts`.

## Quality gates

Before pushing, the husky `pre-push` hook runs `npm run check && npm run test`. Pushing won't succeed if either fails.

The CI workflow (`.github/workflows/ci.yml`) runs five jobs on every PR:

1. `lint-and-check` — ESLint + Prettier + svelte-check
2. `unit-tests` — Vitest + coverage comment on PR
3. `build` — `vite build` + bundle-size budget (1 MB total client JS, 500 KB per chunk)
4. `integration-tests` — Vitest against a local Supabase booted via `supabase/setup-cli@v1`
5. `e2e-tests` — Playwright against a local Supabase + preview server

A PR can't merge until all five are green (see `.github/BRANCH_PROTECTION.md` for the required-check setup).

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

body
```

Common types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`.
Scope is optional; common values: `db`, `realtime`, `grid`, `admin`, `a11y`, `deps`, `observability`.

Examples:

- `feat(db): add create_party RPC`
- `fix(admin): resolve double-effect on payoutSplits`
- `chore(deps): bump @supabase/supabase-js to 2.104`

Each commit should be self-contained — passes lint, check, and tests on its own.

## Code style

- **TypeScript strict.** No `any`, no non-null assertions (`!`), no implicit returns. Use `as` casts only when narrowing types defensively (and prefer hand-written validators where possible — see `src/lib/validators/realtime.ts`).
- **Stores stay legacy, components use runes.** See [ADR-0001](docs/adr/0001-hybrid-reactivity.md) for the why. Don't mix.
- **Comments answer "why", not "what".** Code says what it does; comments say why it's that way and what would break if you "improved" it.
- **No `console.log` in production code.** Lint blocks it. Use `console.warn` with an `eslint-disable-next-line` comment when you need diagnostic logging — the Sentry hooks (`src/hooks.client.ts` / `src/hooks.server.ts`) pick those up when configured.

## Project conventions documented elsewhere

- **Hybrid reactivity model:** [ADR-0001](docs/adr/0001-hybrid-reactivity.md), `CLAUDE.md`
- **Optimistic chain (do not refactor `.then()` to `await`):** [ADR-0002](docs/adr/0002-optimistic-chain.md)
- **Dual realtime channels:** [ADR-0003](docs/adr/0003-dual-realtime-channels.md)
- **Architecture overview:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **E2E testing strategy:** [docs/E2E_TESTING.md](docs/E2E_TESTING.md)
- **Game-day operations:** [GAME-DAY.md](GAME-DAY.md)
- **Security:** [SECURITY.md](SECURITY.md)

## Pull request process

1. Branch from `main`. Naming: `feat/<short>`, `fix/<short>`, `chore/<short>`.
2. Write the change. Keep PRs small and focused — one concern per PR.
3. Run `npm run lint && npm run check && npm run test` locally.
4. Push. CI runs automatically.
5. Open a PR. The template in `.github/pull_request_template.md` lists the required sections.
6. Address review comments via additional commits (don't squash locally — GitHub squashes on merge).
7. CI must be green before merge.

## What I won't merge

- Convert any store from `writable()` to `$state` — see ADR-0001
- Change the `.then()` to `await` in optimistic functions — see ADR-0002
- Edit an existing migration file — write a new numbered one instead
- Add a TODO without a follow-up plan or issue link
- Suppress an ESLint rule without an inline `--` comment explaining why
- Lower a coverage threshold

## Questions?

Open an issue with the `question` label or check existing issues first.
