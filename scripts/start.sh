#!/usr/bin/env bash
#
# Start the workbench with the generated env file. This is the normal entry point; the data-dir
# `.env` wins, then the legacy `kaiming/.env`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/kaiming"

DATA_DIR="${KAIMING_DATA_DIR:-$APP/.kaiming-data}"
case "$DATA_DIR" in
  /*) ;;
  *) DATA_DIR="$APP/$DATA_DIR" ;;
esac
ENV_FILE="$DATA_DIR/.env"
if [ -n "${KAIMING_ENV_FILE:-}" ] && [ -f "$KAIMING_ENV_FILE" ]; then
  ENV_FILE="$KAIMING_ENV_FILE"
fi
if [ ! -f "$ENV_FILE" ] && [ -f "$APP/.env" ]; then
  ENV_FILE="$APP/.env"
fi
if [ ! -f "$ENV_FILE" ]; then
  printf 'scripts/start.sh: no env file found (looked at %s and kaiming/.env); run ./scripts/setup.sh first.\n' "$DATA_DIR/.env" >&2
  exit 1
fi
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
export KAIMING_ENV_FILE="$ENV_FILE"

if [ ! -f "$APP/web-static/index.html" ]; then
  printf 'scripts/start.sh: web-static/index.html is missing; run ./scripts/setup.sh (or npm --prefix kaiming run build).\n' >&2
  exit 1
fi

cd "$APP"
exec node --env-file "$ENV_FILE" "$APP/src/server/main.ts"
