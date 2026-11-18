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
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }
fail() {
  say "FAIL $*"
  dispatch="$HOME/.claude/scripts/incident-dispatch.sh"
  if [ -x "$dispatch" ]; then
    "$dispatch" --project infra --kind squares-keepalive --cwd "$HOME/Projects/Squares" --prio p1 \
      --summary "Squares Supabase keep-alive failed: $* (log: $LOG)" || true
  fi
  exit 1
}

# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"
ref="${SQUARES_REF:-}" anon="${SQUARES_ANON_KEY:-}"
[ -n "$ref" ] && [ -n "$anon" ] || fail "config missing or incomplete: $CONF (rerun ops/keepalive/install.sh)"

token="${SUPABASE_ACCESS_TOKEN:-$(security find-generic-password -s 'Supabase CLI' -w 2>/dev/null || true)}"
token="${token#go-keyring-base64:}"
case "$token" in sbp_*) ;; ?*) token="$(printf '%s' "$token" | base64 -d 2>/dev/null || true)" ;; esac

# The header goes through a config on stdin so the token never appears in argv (ps).
mgmt() { printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -sS -m 30 --config - "$@"; }
# NO_TOKEN / TOKEN_INVALID (401 or 403: revoked, or a token for another account) only lose
# auto-restore; UNKNOWN (network or API error) is retried.
project_status() {
  [ -n "$token" ] || { echo NO_TOKEN; return; }
  local out
  out="$(mgmt -w '\n%{http_code}' "https://api.supabase.com/v1/projects/$ref" 2>/dev/null || true)"
  case "${out##*$'\n'}" in 401|403) echo TOKEN_INVALID; return ;; esac
  printf '%s' "${out%$'\n'*}" |
    python3 -c 'import sys,json; print(json.load(sys.stdin).get("status","UNKNOWN"))' 2>/dev/null || echo UNKNOWN
}
rest_read() {
  curl -sS -m 30 -o /dev/null -w '%{http_code}' -H "apikey: $anon" -H "Authorization: Bearer $anon" \
    "https://$ref.supabase.co/rest/v1/parties?select=id&limit=1" 2>/dev/null || true
}

# Up to 3 attempts 30 s apart: the job can fire at login or on wake before the network is up.
status=UNKNOWN rest=000 restored=""
for attempt in 1 2 3; do
  status="$(project_status)"
  if [ "$status" = "INACTIVE" ] || [ "$status" = "PAUSED" ]; then
    code="$(mgmt -o /dev/null -w '%{http_code}' -X POST "https://api.supabase.com/v1/projects/$ref/restore" || true)"
    restored=" restore_http=${code:-000}"
    case "$code" in
      2*) for _ in $(seq 1 30); do
            sleep 20
            status="$(project_status)"
            [ "$status" = "ACTIVE_HEALTHY" ] && break
          done ;;
    esac
  fi
  rest="$(rest_read)"; rest="${rest:-000}"
  [ "$rest" = "200" ] && [ "$status" != "UNKNOWN" ] && break
  [ "$attempt" = 3 ] || sleep 30
done

if [ "$rest" = "200" ]; then
  # The read is what keeps the project awake; an unusable Management token only loses auto-restore.
  case "$status" in
    ACTIVE_HEALTHY) say "OK status=$status rest=$rest$restored"; exit 0 ;;
    NO_TOKEN|TOKEN_INVALID)
      say "OK status=$status rest=200 (auto-restore off: put a token for the project's Supabase account in the 'Supabase CLI' keychain item, e.g. supabase login)"
      exit 0 ;;
  esac
fi
fail "status=$status rest=$rest$restored"
