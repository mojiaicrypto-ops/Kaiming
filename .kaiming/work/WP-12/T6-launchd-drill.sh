#!/usr/bin/env bash
#
# WP-12 T6 launchd drill (real, on this macOS host).
#
# Loads `apps/cli/templates/com.agentdev.daemon.plist` under a **temporary label** and a
# **temporary `AGENTDEV_HOME`**, proves the service starts the documented daemon, then
# unloads it and proves the cleanup (no stray process, no leftover lock, correct `status`).
#
# Nothing is written under the real `~/Library/LaunchAgents` or the real `~/.agentdev`; the
# substituted plist lives in the drill's temporary home and is removed with it.
#
# Usage: bash .agentdev/work/WP-12/T6-launchd-drill.sh
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../../.." && pwd)"
cli="$repo_root/apps/cli/dist/cli.js"
template="$repo_root/apps/cli/templates/com.agentdev.daemon.plist"
label="com.agentdev.daemon.t6drill"

home_dir="$(mktemp -d "${TMPDIR:-/tmp}/agentdev-t6-launchd-home-XXXXXX")"
home_dir="$(cd "$home_dir" && pwd -P)"
plist="$home_dir/$label.plist"
plist_loaded=0
cleanup() {
  if [ "$plist_loaded" = "1" ]; then
    launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

echo "# launchd drill: label=$label home=$home_dir"
echo "\$ lsof -nP -iTCP:4318 -sTCP:LISTEN"
if lsof -nP -iTCP:4318 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port 4318 is in use; stop other daemons first"
  exit 2
fi
echo "(free)"

# launchd opens StandardOutPath/StandardErrorPath before the process runs, so the log
# directory has to exist first (this is a real install step, see the operations doc).
mkdir -p "$home_dir/logs"

echo "\$ sed -e 's|__NODE__|…|' -e 's|__AGENTDEV_REPO__|…|' -e 's|__AGENTDEV_HOME__|…|' $template > $plist"
sed -e "s|__NODE__|$(command -v node)|g" \
    -e "s|__AGENTDEV_REPO__|$repo_root|g" \
    -e "s|__AGENTDEV_HOME__|$home_dir|g" \
    -e "s|com\.agentdev\.daemon|$label|g" \
    "$template" > "$plist"
echo "\$ launchctl bootstrap gui/$(id -u) $plist"
launchctl bootstrap "gui/$(id -u)" "$plist" && plist_loaded=1
if [ "$plist_loaded" != "1" ]; then
  echo "bootstrap failed; falling back to launchctl load -w"
  launchctl load -w "$plist" && plist_loaded=1
fi
echo "[bootstrap exit $?]"

for _ in $(seq 1 40); do
  [ -f "$home_dir/runtime.json" ] && break
  sleep 0.25
done
sleep 1

echo
echo "\$ AGENTDEV_HOME=$home_dir node apps/cli/dist/cli.js status"
AGENTDEV_HOME="$home_dir" node "$cli" status
status_exit=$?
echo "[exit $status_exit]"

echo
echo "\$ launchctl print gui/$(id -u)/$label | head -20"
launchctl print "gui/$(id -u)/$label" 2>&1 | head -20

daemon_pid="$(node -e "process.stdout.write(String(JSON.parse(require('node:fs').readFileSync('$home_dir/runtime.json','utf8')).pid))" 2>/dev/null)"
echo
echo "daemon pid from runtime.json: ${daemon_pid:-none}"
if [ -n "${daemon_pid:-}" ] && ps -p "$daemon_pid" >/dev/null 2>&1; then
  echo "ok   the launchd service started the daemon (pid $daemon_pid)"
else
  echo "FAIL the launchd service did not start the daemon"
fi
[ -f "$home_dir/daemon.lock" ] && echo "ok   the daemon holds daemon.lock while running" || echo "FAIL no daemon.lock"
[ "$status_exit" = "0" ] && echo "ok   agentdev status exited 0 while the service runs" || echo "FAIL agentdev status exit $status_exit"

echo
echo "\$ launchctl bootout gui/$(id -u)/$label"
launchctl bootout "gui/$(id -u)/$label"
plist_loaded=0
echo "[bootout exit $?]"
sleep 1
for _ in $(seq 1 40); do
  [ ! -f "$home_dir/runtime.json" ] && break
  sleep 0.25
done
AGENTDEV_HOME="$home_dir" node "$cli" stop >/dev/null 2>&1

echo
echo "\$ AGENTDEV_HOME=$home_dir node apps/cli/dist/cli.js status"
AGENTDEV_HOME="$home_dir" node "$cli" status
after_exit=$?
echo "[exit $after_exit]"

echo
if [ -n "${daemon_pid:-}" ] && ps -p "$daemon_pid" >/dev/null 2>&1; then
  echo "FAIL process $daemon_pid survived the unload"
else
  echo "ok   no daemon process left after the unload"
fi
if [ -f "$home_dir/daemon.lock" ]; then
  echo "FAIL daemon.lock left behind"
else
  echo "ok   no leftover daemon.lock"
fi
if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
  echo "FAIL the launchd job is still loaded"
else
  echo "ok   the launchd job is unloaded"
fi
if grep -q '"running": false' <(AGENTDEV_HOME="$home_dir" node "$cli" status 2>/dev/null); then
  echo "ok   agentdev status reports the runtime stopped"
else
  echo "FAIL agentdev status does not report the runtime stopped"
fi
echo
echo "drill home kept for inspection: $home_dir"
