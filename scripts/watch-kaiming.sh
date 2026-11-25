#!/usr/bin/env bash
set -u

SERVER_PID="${1:-}"
if [ -z "$SERVER_PID" ]; then
  SERVER_PID=$(pgrep -f 'src/server/main.ts' | head -1)
fi
if [ -z "$SERVER_PID" ]; then
  echo "没有找到 Kaiming workbench"; exit 1
fi

tree() {
  local parent="$1"
  local indent="${2:-}"
  local child line
  for child in $(pgrep -P "$parent" 2>/dev/null); do
    line=$(ps -o pid=,ppid=,etime=,command= -p "$child" 2>/dev/null)
    [ -n "$line" ] && printf '%s%s\n' "$indent" "$line"
    tree "$child" "$indent  "
  done
}

echo "watching server PID $SERVER_PID; Ctrl-C 停止"
while :; do
  printf '\n===== %s =====\n' "$(date '+%H:%M:%S')"
  if pgrep -P "$SERVER_PID" >/dev/null 2>&1; then
    tree "$SERVER_PID"
  else
    echo "(当前没有子进程)"
  fi
  sleep 1
done
