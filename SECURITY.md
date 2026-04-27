# Security Policy

## Supported versions

This is a personal project shipped from `main`. There is no LTS branch — security fixes land on `main` and are deployed automatically via Cloudflare Pages.

| Branch | Supported      |
| ------ | -------------- |
| `main` | Yes (deployed) |
| Other  | No             |

## Reporting a vulnerability

If you've found a security issue, **please do not open a public GitHub issue**.

Email **nkrebs720@gmail.com** with:

- A description of the issue
- Steps to reproduce (or a proof-of-concept)
- The version / commit SHA you tested against
- Whether you've already disclosed elsewhere

I'll acknowledge receipt within 7 days and aim to ship a fix within 14 days for high-severity issues, longer for lower-severity. I'll credit you in the fix commit unless you'd rather stay anonymous.

## What's in scope

- The deployed app at the production URL (linked from the README)
- The code in this repository (frontend + Supabase migrations)
- The `create_party`, `claim_square`, `unclaim_square`, `claim_squares_batch`, `lock_party`, `update_score`, `update_payout_structure`, `verify_host_pin`, `delete_party` RPCs

## What's out of scope

- The hosting layer (Cloudflare Pages itself, Supabase's managed infrastructure)
- Browser-vendor security issues
- Third-party services (ESPN scores API, etc.)
- Issues requiring physical access to the user's device

## Known accepted risks

These are documented in [security-todo.md](security-todo.md) with the rationale for accepting them. They are not unfixed bugs — they are intentional trade-offs for a friend-group party-pool app:

- **PIN brute-force is technically possible** (4-digit PIN, no rate-limit at the application layer beyond 5-attempt lockout). Acceptable because parties are time-bounded and use codes shared only with friends.
- **Client-side PIN check is UX convenience only.** All RPCs that require PIN authorization re-verify server-side via `check_pin_lockout`.
- **Anyone who knows a player's name can unclaim that player's square** if they know the party code. Acceptable for the friend-group use case; preventing it would require server-side session tokens that add complexity disproportionate to the threat.
- **`claim_squares_batch` is not transactionally atomic across all cells** — partial failures leave some cells claimed. Acceptable; the failure modes are network errors which are rare and the UI surfaces what got through.

If you find an issue NOT in this list, it's in scope.

## Past security work

This project was security-audited in January 2026. The audit findings (resolved + accepted) are tracked in [security-todo.md](security-todo.md). One audit finding — leaked DB password in git history — required a manual rotation in the Supabase dashboard before the repository went public.
