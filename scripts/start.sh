#!/usr/bin/env bash
#
# Start the workbench with the generated local .env. This is the normal entry point;
# use `npm --prefix kaiming start` only when you already manage the environment yourself.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/kaiming"

if [ ! -f "$APP/.env" ]; then
  printf 'scripts/start.sh: kaiming/.env is missing; run ./scripts/setup.sh first.\n' >&2
  exit 1
fi

if [ ! -f "$APP/web-static/index.html" ]; then
  printf 'scripts/start.sh: web-static/index.html is missing; run ./scripts/setup.sh (or npm --prefix kaiming run build).\n' >&2
  exit 1
fi

exec npm --prefix "$APP" start
