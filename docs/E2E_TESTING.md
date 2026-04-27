# E2E Testing

Playwright tests live in `e2e/`. The `webServer` config in `playwright.config.ts` builds the app and starts a preview server on `http://localhost:4173` automatically, so a single command runs the whole suite.

## Running the suite

```bash
npm run test:e2e            # headless, all projects (Chromium + Mobile Chrome)
npm run test:e2e:ui         # opens the Playwright UI runner
npm run test:e2e:debug      # debugger / pause between steps
npm run test:e2e:report     # opens the HTML report from the last run
```

## Test inventory

| File                     | Purpose                                                       | Backend                |
| ------------------------ | ------------------------------------------------------------- | ---------------------- |
| `golden-path.spec.ts`    | Create → join → grid render → active → complete user journey  | Mocked Supabase routes |
| `party-flow.spec.ts`     | Mid-game flows                                                | Mocked                 |
| `admin.spec.ts`          | Host PIN + admin controls                                     | Mocked                 |
| `create-party.spec.ts`   | Create form validation                                        | Mocked                 |
| `join-party.spec.ts`     | Join form + name conflict                                     | Mocked                 |
| `landing.spec.ts`        | Home page                                                     | Mocked                 |
| `error-recovery.spec.ts` | Error toast paths                                             | Mocked                 |
| `accessibility.spec.ts`  | A11y attributes + keyboard checks                             | Mocked                 |
| `visual.spec.ts`         | Visual regression for filling / active / complete grid states | Mocked                 |

## Visual regression

`visual.spec.ts` captures screenshots of three party-page states and compares them against committed baselines in `e2e/visual.spec.ts-snapshots/`.

### Generating a fresh baseline

When the UI changes intentionally:

```bash
npm run test:e2e -- visual.spec.ts --update-snapshots
git add e2e/visual.spec.ts-snapshots/
git commit -m "test(visual): update baselines for <description>"
```

### Tolerance

`playwright.config.ts` sets `toHaveScreenshot.maxDiffPixels: 100` and `animations: 'disabled'`. Bump if false positives become noisy on CI vs local runs (font rendering can drift between macOS and Linux Chromium).

### CI considerations

CI runs visual regression on Linux Chromium. Baselines should be generated on Linux to avoid platform diffs — use the `actions/setup-node@v4` + `npx playwright install --with-deps chromium` flow in `.github/workflows/ci.yml`. To regenerate on a Mac for fast iteration, then re-baseline on Linux before merging:

```bash
# Locally on macOS to iterate:
npm run test:e2e -- visual.spec.ts --update-snapshots

# On Linux (CI or container) to commit final baseline:
docker run --rm -v "$PWD":/app -w /app mcr.microsoft.com/playwright:v1.59.1-noble \
  npx playwright test visual.spec.ts --update-snapshots
```

## Real-Supabase rewrite (deferred)

The plan called for `golden-path.spec.ts` to be rewritten against a real local Supabase (boots via `supabase start` in CI, exercises actual RPCs end-to-end). That rewrite is **deferred** because:

1. It depends on Phase 1's `create_party` RPC migration being on `main`.
2. Generating + running it requires Docker / Colima for `supabase start`, which the agent that opened this PR didn't have.

The path forward when both unblock:

1. Apply Phase 1's migration locally via `supabase db reset`.
2. Replace `page.route()` mocks in `golden-path.spec.ts` with real navigation + form submissions against `http://127.0.0.1:54321`.
3. Wire the same setup into the `e2e-tests` job in `.github/workflows/ci.yml` (the Phase 2 workflow already includes `supabase/setup-cli@v1` boilerplate).
4. Delete `e2e/fixtures/supabase-mocks.ts` (most of it; keep `setUserName` and any other pure helpers).

`visual.spec.ts` deliberately stays on mocked fixtures even after the rewrite — visual regression needs deterministic input, which mocks deliver more reliably than a fresh Supabase database.
