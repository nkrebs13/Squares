# Branch Protection Configuration

Required GitHub repository settings for production safety.
Configure these in **Settings > Branches > Branch protection rules** for `main`.

**Last verified against CI**: 2026-04-26 — all five job IDs below are byte-for-byte identical to job IDs in `.github/workflows/ci.yml`.

## Required Status Checks

Enable **"Require status checks to pass before merging"** with these required checks:

- `Lint, Format & Type Check` (lint-and-check)
- `Unit Tests` (unit-tests)
- `Build Verification` (build)
- `Integration Tests (Supabase)` (integration-tests)
- `E2E Tests` (e2e-tests)

Enable **"Require branches to be up to date before merging"**.

## Pull Request Reviews

- **Require a pull request before merging**: Enabled
- **Required approvals**: 1 (minimum)
- **Dismiss stale pull request approvals when new commits are pushed**: Enabled

## Additional Protections

- **Restrict who can push to matching branches**: Enabled (admins only for direct push)
- **Do not allow force pushes**: Enabled
- **Do not allow deletions**: Enabled
- **Require linear history**: Recommended (prevents merge commits, enforces rebase)

## Why This Matters

Without branch protection, any of the 5 CI jobs can be bypassed by pushing directly
to main. The entire CI pipeline becomes advisory rather than enforcement. This is the
single most important hardening measure — all other quality gates depend on it.
