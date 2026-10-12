#!/usr/bin/env bash
# Starts Google Chrome with a DEDICATED profile and the DevTools port open on 127.0.0.1 only.
# Log in to Instagram once in this window. Keep it open while the worker runs.
set -euo pipefail
PROFILE_DIR="${CHROME_PROFILE_DIR:-$(cd "$(dirname "$0")/.." && pwd)/.chrome-profile}"
PORT="${CHROME_DEBUG_PORT:-9222}"
mkdir -p "$PROFILE_DIR"
case "$(uname -s)" in
  Darwin) CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ;;
  Linux)  CHROME="${CHROME_BIN:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser)}" ;;
  *) echo "Use scripts/chrome-debug.ps1 no Windows."; exit 1 ;;
esac
if [ ! -x "$CHROME" ] && ! command -v "$CHROME" >/dev/null 2>&1; then
  echo "Chrome não encontrado em: $CHROME (defina CHROME_BIN)."; exit 1
fi
echo "Perfil dedicado: $PROFILE_DIR"
echo "Porta de depuração: 127.0.0.1:$PORT (nunca 0.0.0.0)"
exec "$CHROME" \
  --user-data-dir="$PROFILE_DIR" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --no-first-run --no-default-browser-check \
  "https://www.instagram.com/"
