# Security TODO

Items identified during security audit (2026-01-28). Status last reviewed: 2026-04-26.

> **For external researchers:** see [SECURITY.md](SECURITY.md) for the responsible-disclosure path. This file documents internal status of known issues + accepted risks; SECURITY.md is the public-facing version.

---

## CRITICAL: Rotate Database Credentials — MANUAL ACTION REQUIRED

**Status**: `run-migration.mjs` has been deleted from the repo, but the old password remains in git history permanently.

**Required action**: Rotate the database password via Supabase Dashboard > Project Settings > Database. No code change can fix this — it's a manual step.

---

## HIGH: SSL Verification Disabled — RESOLVED

**Status**: Resolved. The file `run-migration.mjs` (which had `rejectUnauthorized: false`) has been deleted from the repo.

---

## HIGH: PIN Brute-Forceable — OPEN (low practical risk)

**Status**: No rate limiting exists on PIN attempts. The `011_pin_rate_limiting.sql` migration was removed during cleanup.

**Practical risk**: Low for Super Bowl Sunday usage. 4-digit PIN with a small number of known friends. An attacker would need the party code and motivation.

**If addressing later**: Add rate limiting at the RPC level (track failed attempts per `party_id`, lock after N failures).

---

## HIGH: Client-Side PIN Validation — ACCEPTED RISK

**Status**: Accepted. Client-side PIN check is a UX convenience only. The server-side RPCs (`lock_party`, `update_score`, `verify_host_pin`, `delete_party`) all independently validate the PIN regardless.

---

## HIGH: Unclaim Bypass — ACCEPTED RISK

**Status**: Accepted. Anyone who knows a player's name can unclaim their square. In the party context (friends at a Super Bowl gathering), this is a known and acceptable tradeoff. Adding session tokens would add complexity with minimal benefit for the use case.

---

## MEDIUM: Batch Claim Atomicity — OPEN (low practical risk)

**Status**: Open. `claim_squares_batch` processes cells in a loop. If one fails mid-way, earlier claims persist while later ones fail silently. Partial failures are possible but unlikely and acceptable for the use case.

---

## Notes

- Original audit: 2026-01-28 (Claude Code security review)
- Status review: 2026-02-03
- Priority: Rotate database password before launch (manual action)
