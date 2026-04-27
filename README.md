# Football Squares

> Real-time multiplayer Super Bowl pool. Friends claim squares on a 10×10 grid; payouts go to whoever owns the cell whose row/column digits match the score at quarter-end. Built and run on Super Bowl Sunday for ~50 concurrent players.

**Live: [squares.nathankrebs.com](https://squares.nathankrebs.com)**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/nkrebs13/squares/actions/workflows/ci.yml/badge.svg)](https://github.com/nkrebs13/squares/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-691%20passing-success)](https://github.com/nkrebs13/squares/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/branches-82%25-brightgreen)](https://github.com/nkrebs13/squares/actions/workflows/ci.yml)

## Why this exists

Office and friend-group "squares" pools usually run via a paper grid + Venmo. Anyone joining late can't see the live grid. Anyone leaving early can't see who won which quarter. The host has to manually track scores against a paper-and-pen grid while paying attention to the actual game.

This app collapses all of that into a shared URL. Friends claim cells in real time, the host enters scores at quarter-end, the app computes winners and shows a payout summary. No accounts, no money flowing through the app — just the bookkeeping.

## Features

- **Real-time grid sync** — sub-100ms cross-client updates via Supabase broadcast + postgres_changes (see [ADR-0003](docs/adr/0003-dual-realtime-channels.md))
- **Optimistic claims with rollback** — taps feel instant; failed claims roll back with a toast (see [ADR-0002](docs/adr/0002-optimistic-chain.md))
- **Multiple payout structures** — Rising / Equal / Big Finish / Custom
- **Host PIN protection** for grid lock, score entry, payout edits, party deletion
- **PWA installable** on iOS + Android with push notifications
- **ESPN live score auto-detect** — links to the active NFL game without manual setup
- **Color-coded player legend** with click-to-filter
- **Pan and zoom** for usable squares on small phones
- **WCAG 2.1 AA targets** — ARIA grid markup, dialog modal with focus trap, semantic forms

## Tech stack

| Layer         | Choice                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| Frontend      | SvelteKit 5 (runes in components, legacy stores in shared state — [why](docs/adr/0001-hybrid-reactivity.md)) |
| Styling       | Tailwind 4 + CSS variables                                                                                   |
| Language      | TypeScript 6 strict                                                                                          |
| Backend       | Supabase (Postgres + Realtime + RPC)                                                                         |
| Hosting       | Cloudflare Pages, Vercel, Netlify, or self-hosted Node — see [DEPLOY.md](docs/DEPLOY.md)                     |
| Observability | Sentry + Web Vitals (optional, no-op without DSN)                                                            |
| Testing       | Vitest (unit + integration) + Playwright (e2e + visual regression)                                           |
| CI            | GitHub Actions — 5 jobs gating every PR                                                                      |

## Quick start

### Prerequisites

- Node 20+
- A [Supabase](https://supabase.com) project (free tier works)

### Installation

```bash
git clone https://github.com/nkrebs13/squares.git
cd squares
npm install
cp .env.example .env.local
# Edit .env.local: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                   # http://localhost:5173
```

### Database setup

Apply the migrations to your Supabase project:

```bash
# Option A: Supabase CLI (recommended)
supabase link --project-ref <your-ref>
supabase db push

# Option B: Manually paste each migration in the Supabase SQL Editor
# in numerical order: supabase/migrations/001_*.sql through 023_*.sql
```

### Demo data

Running `supabase db reset` applies all migrations and seeds a demo party automatically. After reset, visit `/party/DEMO01` (PIN: `0000`) to see a partially-filled grid with four fictional players. To skip seeding, delete `supabase/seed.sql` before running reset.

### Optional: Error tracking

Set `PUBLIC_SENTRY_DSN` in `.env.local` to send unhandled errors and Web Vitals (CLS, INP, LCP, FCP, TTFB) to a [Sentry](https://sentry.io) project. The free tier is sufficient for portfolio-level traffic; the app works identically with the variable unset.

```env
PUBLIC_SENTRY_DSN=https://...@...ingest.sentry.io/...
```

## Deployment

The repo uses `@sveltejs/adapter-auto`, so the same source ships unchanged to:

- **Cloudflare Pages** — canonical production target ([squares.nathankrebs.com](https://squares.nathankrebs.com) runs here)
- **Vercel** — [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnkrebs13%2Fsquares&env=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY)
- **Netlify** — [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/nkrebs13/squares)
- **Self-host (Node)** — drop in `@sveltejs/adapter-node` per the guide

Full step-by-step instructions, env-var lists, custom-domain notes, and troubleshooting in [`docs/DEPLOY.md`](docs/DEPLOY.md).

### Customizing your fork

Brand strings, default team labels, and currency live in [`src/lib/config.ts`](src/lib/config.ts) and read from `PUBLIC_*` env vars at build time. To rebrand without touching code, set the relevant entries in `.env.local` (or your platform's env-var dashboard) before `npm run build`:

| Env var                         | Default                                |
| ------------------------------- | -------------------------------------- |
| `PUBLIC_APP_NAME`               | `Football Squares`                     |
| `PUBLIC_APP_TAGLINE`            | `Super Bowl party pools made easy`     |
| `PUBLIC_APP_DESCRIPTION`        | `Real-time Super Bowl squares pool. …` |
| `PUBLIC_DEFAULT_TEAM_ROW_NAME`  | `Seahawks`                             |
| `PUBLIC_DEFAULT_TEAM_ROW_COLOR` | `#69BE28`                              |
| `PUBLIC_DEFAULT_TEAM_COL_NAME`  | `Patriots`                             |
| `PUBLIC_DEFAULT_TEAM_COL_COLOR` | `#C60C30`                              |
| `PUBLIC_CURRENCY_CODE`          | `USD` (any ISO 4217 code)              |
| `PUBLIC_LOCALE`                 | `en-US` (any BCP 47 locale)            |

`PUBLIC_APP_NAME` and `PUBLIC_APP_DESCRIPTION` are also picked up by the PWA manifest in `vite.config.ts`. All values fall back to the defaults above when unset, so a stock fork keeps the Football Squares experience.

## Architecture

The 10-minute orientation is in [ARCHITECTURE.md](ARCHITECTURE.md). The deepest design decisions get their own ADRs:

- [ADR-0001: Hybrid reactivity](docs/adr/0001-hybrid-reactivity.md) — why stores stay legacy and components use runes
- [ADR-0002: Optimistic update chain](docs/adr/0002-optimistic-chain.md) — why `.then()` instead of `await`, and what the 8 steps are
- [ADR-0003: Dual realtime channels](docs/adr/0003-dual-realtime-channels.md) — why both broadcast AND postgres_changes

If you've cloned the repo and want to know "where does X live and why", that's the path.

## Development

| Command                     | Purpose                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `npm run dev`               | Start dev server at `http://localhost:5173`                |
| `npm run build`             | Production build (adapter auto-detects deploy platform)    |
| `npm run preview`           | Preview the production build at `http://localhost:4173`    |
| `npm run check`             | TypeScript + Svelte diagnostics                            |
| `npm run lint`              | ESLint + `--max-warnings 0`                                |
| `npm run lint:fix`          | Auto-fix lint issues                                       |
| `npm run format`            | Prettier write                                             |
| `npm run test`              | Unit tests (Vitest)                                        |
| `npm run test:coverage`     | Unit tests + coverage report (thresholds enforced)         |
| `npm run test:integration`  | Integration tests (requires `supabase start`)              |
| `npm run test:e2e`          | Playwright (Chromium + Mobile Chrome)                      |
| `npm run check:bundle-size` | Bundle-size budget check (after `npm run build`)           |
| `npm run db:types`          | Regenerate `src/lib/database.types.ts` from local Supabase |

## Project structure

```
src/
├── routes/
│   ├── +page.svelte              Home (CTA + RecentParties)
│   ├── create/+page.svelte       Create party
│   ├── join/+page.svelte         Join party (with PIN modal for host names)
│   └── party/[code]/
│       ├── +page.svelte          Grid + sidebar
│       └── admin/+page.svelte    Host panel
├── lib/
│   ├── components/               Reusable UI (Square, SimpleGrid, PartySidebar, …)
│   ├── stores/                   Realtime + state + optimistic update chain
│   ├── services/                 Service modules (createParty)
│   ├── validators/               Hand-written runtime guards for postgres_changes
│   └── types.ts                  TypeScript definitions
├── hooks.client.ts               Sentry init + Web Vitals
└── hooks.server.ts               Sentry init for the resolved SvelteKit adapter
supabase/
└── migrations/                   Forward-only SQL (don't edit existing files)
e2e/                              Playwright specs + visual regression
docs/                             Architecture, ADRs, E2E testing strategy
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full process. Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating. Short version:

1. Branch from `main`
2. Run `npm run lint && npm run check && npm run test` locally
3. Open a PR; CI must be green before merge

## License

MIT — see [LICENSE](LICENSE).

## Author

Built by [Nathan Krebs](https://github.com/nkrebs13). Originally for Super Bowl 2026 with friends; now public as a portfolio piece.
