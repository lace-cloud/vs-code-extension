#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROTO_FILE="$ROOT_DIR/proto/service.proto"
PLUGIN="$ROOT_DIR/node_modules/.bin/protoc-gen-ts_proto"

# Shared ts-proto options across all three invocations
SHARED_OPTS="snakeToCamel=false,forceLong=number,esModuleInterop=true"

# ── Prereqs ──
command -v protoc >/dev/null 2>&1 || { echo "error: protoc not found in PATH"; exit 1; }
[ -f "$PLUGIN" ] || { echo "error: protoc-gen-ts_proto not found — run pnpm install"; exit 1; }
[ -f "$PROTO_FILE" ] || { echo "error: proto/service.proto not found"; exit 1; }

# ── Output 1: Shared message types (@lace/proto) ──
# Environment-neutral, no service stubs. All packages import message types from here.
echo "→ Generating @lace/proto messages..."
OUT1="$ROOT_DIR/packages/proto/src/generated"
rm -rf "$OUT1"
mkdir -p "$OUT1"
protoc \
  --plugin="$PLUGIN" \
  --ts_proto_out="$OUT1" \
  --ts_proto_opt="outputServices=false,$SHARED_OPTS,env=node" \
  --proto_path="$ROOT_DIR/proto" \
  "$PROTO_FILE"

# ── Output 2: Host gRPC-JS service stubs (@lace/host) ──
# Node.js-only, generates gRPC-JS client constructor + method overloads.
echo "→ Generating @lace/host gRPC-JS glue..."
OUT2="$ROOT_DIR/packages/host/src/generated"
rm -rf "$OUT2"
mkdir -p "$OUT2"
protoc \
  --plugin="$PLUGIN" \
  --ts_proto_out="$OUT2" \
  --ts_proto_opt="outputServices=grpc-js,$SHARED_OPTS,env=node" \
  --proto_path="$ROOT_DIR/proto" \
  "$PROTO_FILE"

# ── Output 3: Canvas browser service definitions (@lace/canvas) ──
# Browser-safe codegen with JSON toJSON/fromJSON methods used by our
# hand-rolled Connect-JSON client (packages/canvas/src/connect-web-engine.ts).
# No runtime dependency on @connectrpc/*.
echo "→ Generating @lace/canvas browser-side glue..."
OUT3="$ROOT_DIR/packages/canvas/src/generated"
rm -rf "$OUT3"
mkdir -p "$OUT3"
protoc \
  --plugin="$PLUGIN" \
  --ts_proto_out="$OUT3" \
  --ts_proto_opt="outputServices=generic-definitions,outputJsonMethods=true,$SHARED_OPTS,env=browser" \
  --proto_path="$ROOT_DIR/proto" \
  "$PROTO_FILE"

echo "✓ Proto generation complete"
echo "  Output 1: $OUT1 (shared messages)"
echo "  Output 2: $OUT2 (gRPC-JS)"
echo "  Output 3: $OUT3 (Connect-Web)"
