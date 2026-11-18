#!/usr/bin/env bash
# Daily Supabase keep-alive for the production Squares project (free tier pauses after a week
# without traffic). Reads `parties` through the REST API, checks the project status through the
# Management API, and restores the project if it is paused. One log line per run:
#   OK status=ACTIVE_HEALTHY rest=200      or      FAIL status=<s> rest=<code> ...
# Config: ~/.config/squares-keepalive/env (written by install.sh; SQUARES_REF, SQUARES_ANON_KEY).
# The Management API token is read from the Supabase CLI's keychain item, never stored here.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

CONF="${SQUARES_KEEPALIVE_CONF:-$HOME/.config/squares-keepalive/env}"
LOG="${SQUARES_KEEPALIVE_LOG:-$HOME/Library/Logs/squares-keepalive.log}"
# shellcheck disable=SC1090
. "$CONF"
ref="${SQUARES_REF:?}" anon="${SQUARES_ANON_KEY:?}"

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }

token="${SUPABASE_ACCESS_TOKEN:-$(security find-generic-password -s 'Supabase CLI' -w 2>/dev/null || true)}"
token="${token#go-keyring-base64:}"
case "$token" in sbp_*) ;; ?*) token="$(printf '%s' "$token" | base64 -d 2>/dev/null || true)" ;; esac

mgmt() { curl -sS -m 30 -H "Authorization: Bearer $token" "$@"; }
project_status() {
  [ -n "$token" ] || { echo NO_TOKEN; return; }
  mgmt "https://api.supabase.com/v1/projects/$ref" 2>/dev/null |
    python3 -c 'import sys,json; print(json.load(sys.stdin).get("status","UNKNOWN"))' 2>/dev/null || echo UNKNOWN
}
rest_read() {
  curl -sS -m 30 -o /dev/null -w '%{http_code}' -H "apikey: $anon" -H "Authorization: Bearer $anon" \
    "https://$ref.supabase.co/rest/v1/parties?select=id&limit=1" 2>/dev/null || echo 000
}

status="$(project_status)"
restored=""
if [ "$status" = "INACTIVE" ] || [ "$status" = "PAUSED" ]; then
  code="$(mgmt -o /dev/null -w '%{http_code}' -X POST "https://api.supabase.com/v1/projects/$ref/restore" || echo 000)"
  restored=" restore_http=$code"
  for _ in $(seq 1 30); do
    sleep 20
    status="$(project_status)"
    [ "$status" = "ACTIVE_HEALTHY" ] && break
  done
fi
rest="$(rest_read)"

if [ "$rest" = "200" ] && { [ "$status" = "ACTIVE_HEALTHY" ] || [ "$status" = "NO_TOKEN" ]; }; then
  # The read is what keeps the project awake; a missing Management token only loses auto-restore.
  if [ "$status" = "NO_TOKEN" ]; then say "OK status=NO_TOKEN rest=200 (run 'supabase login' to re-enable auto-restore)"
  else say "OK status=$status rest=$rest$restored"; fi
  exit 0
fi
say "FAIL status=$status rest=$rest$restored"
dispatch="$HOME/.claude/scripts/incident-dispatch.sh"
if [ -x "$dispatch" ]; then
  "$dispatch" --project infra --kind squares-keepalive --cwd "$HOME/Projects/Squares" --prio p1 \
    --summary "Squares Supabase keep-alive failed: status=$status rest=$rest$restored (log: $LOG)" || true
fi
exit 1
