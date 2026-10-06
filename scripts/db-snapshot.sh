#!/usr/bin/env bash
# Writes the current LOCAL Supabase schema to supabase/schema.snapshot.sql.
# Requires `supabase start` with migrations applied (`supabase db reset`).
set -euo pipefail
out=supabase/schema.snapshot.sql
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
supabase db dump --local -f "$tmp"
{
	cat <<'H'
-- GENERATED FILE - never hand-edit. Regenerate with `npm run db:snapshot`
-- after adding a migration. This is the place to read current RPC bodies
-- (migrations only show history; this shows the resulting schema).
H
	cat "$tmp"
} >"$out"
