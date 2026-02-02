Run the full quality gate suite and report results.

1. Run `npm run check` (svelte-check type checking)
2. Run `npm run lint` (ESLint)
3. Run `npm run test:coverage` (Vitest with coverage)

For each step, report pass/fail. For the test step, also report:
- Total test count (passed/failed/skipped)
- Coverage summary (lines, functions, branches, statements percentages)

If any step fails, stop and report the failure details.
