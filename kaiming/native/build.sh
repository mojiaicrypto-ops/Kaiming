#!/usr/bin/env bash
# Build the local macOS helper used by the `gui` tool. The generated app bundle is intentionally
# ignored by git; it is ad-hoc signed for local use. TCC permission is granted to this app, not to
# node, the tester sandbox or the workbench process.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$ROOT/GuiCapture.app"
BIN="$APP/Contents/MacOS/GuiCapture"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "GuiCapture.app is macOS-only" >&2
  exit 2
fi
if ! command -v xcrun >/dev/null 2>&1 || ! command -v codesign >/dev/null 2>&1; then
  echo "Xcode Command Line Tools (xcrun/codesign) are required" >&2
  exit 2
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
xcrun swiftc -O \
  -framework CoreGraphics \
  -framework ImageIO \
  -framework UniformTypeIdentifiers \
  -o "$BIN" "$ROOT/gui-capture.swift"
cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP" >/dev/null

echo "built $APP"
echo "TCC: grant Screen Recording to 'Kaiming GUI Capture' in System Settings -> Privacy & Security -> Screen Recording."
