Create a commit with quality checks.

1. Stage the relevant changed files (review with `git status` first)
2. Run `npm run check` — abort if fails
3. Run `npm run lint` — abort if fails
4. Run `npm run test` — abort if fails
5. Create commit with conventional commit message format (e.g., `feat:`, `fix:`, `test:`, `chore:`, `docs:`)

If any check fails, report the failure and do NOT commit.
