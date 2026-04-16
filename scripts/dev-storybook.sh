#!/usr/bin/env bash
# Launches Storybook with a live `lace engine` attached, so flow stories can
# drive the real CLI over Connect-JSON. The 5-line handshake parser mirrors
# packages/host/src/engine-process.ts so env/test behaviour stays in sync.
#
# The CLI should be built with `-tags=test` (run `make build-test` in lace-cli
# then install to a PATH location) if flow stories want deterministic embedded
# seed fixtures via TestSessionOpen. The default `lace engine` command accepts
# no `-tags` flag — that's a Go compile-time build tag, not a runtime option.
#
# Usage: pnpm run dev:storybook-flows
# Env: LACE_BIN (default: `lace`). Override when the binary isn't on PATH.

set -euo pipefail

LACE_BIN="${LACE_BIN:-lace}"
if ! command -v "$LACE_BIN" >/dev/null 2>&1; then
  echo "error: '$LACE_BIN' not found on PATH. Set LACE_BIN or install the CLI." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TMPOUT="$(mktemp -t lace-engine-handshake.XXXXXX)"

cleanup() {
  if [ -n "${ENGINE_PID:-}" ] && kill -0 "$ENGINE_PID" 2>/dev/null; then
    kill "$ENGINE_PID" 2>/dev/null || true
    wait "$ENGINE_PID" 2>/dev/null || true
  fi
  rm -f "$TMPOUT"
}
trap cleanup EXIT INT TERM

echo "→ Spawning lace engine ..."
"$LACE_BIN" engine >"$TMPOUT" 2>&1 &
ENGINE_PID=$!

# Wait up to 10s for the READY line.
for _ in $(seq 1 100); do
  if grep -q '^LACE_ENGINE_READY' "$TMPOUT" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
    echo "error: engine exited before READY. Output:" >&2
    cat "$TMPOUT" >&2
    exit 1
  fi
  sleep 0.1
done

if ! grep -q '^LACE_ENGINE_READY' "$TMPOUT" 2>/dev/null; then
  echo "error: engine did not emit LACE_ENGINE_READY within 10s. Output:" >&2
  cat "$TMPOUT" >&2
  exit 1
fi

# Parse handshake values. Lines look like `LACE_ENGINE_PORT=54321`.
PORT="$(grep '^LACE_ENGINE_PORT=' "$TMPOUT" | head -n1 | cut -d= -f2)"
TOKEN="$(grep '^LACE_ENGINE_TOKEN=' "$TMPOUT" | head -n1 | cut -d= -f2)"

if [ -z "$PORT" ] || [ -z "$TOKEN" ]; then
  echo "error: handshake missing PORT or TOKEN. Full output:" >&2
  cat "$TMPOUT" >&2
  exit 1
fi

export STORYBOOK_LACE_ENGINE_URL="http://127.0.0.1:$PORT"
export STORYBOOK_LACE_ENGINE_TOKEN="$TOKEN"
echo "→ engine ready: $STORYBOOK_LACE_ENGINE_URL (token: ${TOKEN:0:8}…)"
echo "→ Launching Storybook on :6006 ..."

cd "$ROOT_DIR"
pnpm --filter @lace/canvas-stories run dev
