#!/usr/bin/env bash
# Install (or refresh) the daily keep-alive LaunchAgent com.nkrebs.squares-keepalive on this Mac.
#   ops/keepalive/install.sh <supabase-project-ref>
# Needs a logged-in Supabase CLI. Copies the script out of the checkout so the job does not depend
# on the repo staying on a given branch, writes the config (mode 600), loads the agent, runs it once.
set -euo pipefail
ref="${1:?usage: install.sh <supabase-project-ref>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
label="com.nkrebs.squares-keepalive"
bin_dir="$HOME/.local/share/squares-keepalive"
conf_dir="$HOME/.config/squares-keepalive"
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/squares-keepalive.log"
# Full Disk Access host: macOS TCC checks a launchd job's non-Apple binaries under their own identity, so the
# job starts through FDAHost.app, which execs the rest of argv.
fdahost="$HOME/Applications/FDAHost.app/Contents/MacOS/fdahost"
[[ -x "$fdahost" ]] || { echo "FDAHost.app missing ($fdahost); run ~/.claude/scripts/fdahost/build.sh and grant it Full Disk Access" >&2; exit 1; }

anon="$(supabase projects api-keys --project-ref "$ref" -o json |
  python3 -c 'import sys,json; print(next(k["api_key"] for k in json.load(sys.stdin) if k.get("name")=="anon"))')"
mkdir -p "$bin_dir" "$conf_dir" "$(dirname "$plist")"
install -m 755 "$here/squares-keepalive.sh" "$bin_dir/squares-keepalive.sh"
( umask 077; printf 'SQUARES_REF=%s\nSQUARES_ANON_KEY=%s\n' "$ref" "$anon" >"$conf_dir/env" )

cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$fdahost</string><string>/bin/bash</string><string>$bin_dir/squares-keepalive.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>17</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
# bootout returns before teardown finishes; RunAtLoad starts the first run on bootstrap.
for _ in 1 2 3; do
  launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null && break
  sleep 2
done
launchctl print "gui/$(id -u)/$label" >/dev/null
# A first run may show a one-time keychain dialog for the Supabase CLI token: choose "Always Allow".
sleep 12
tail -n 2 "$log"
