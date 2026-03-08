# Lace VS Code Extension

VS Code extension for visually composing Terraform modules. Users browse
modules from a registry sidebar, add them to a ReactFlow canvas, wire
inputs/outputs, configure settings, and generate `.tf` files. The extension
talks to a Go CLI binary (`lace`) over JSON-RPC stdin/stdout.

## Build & Test

```
npm run test:unit        # 64 unit tests (no binary needed) — run after EVERY change
npm run test:e2e         # 6 tests (requires lace + terraform)
npx tsc --noEmit         # Type-check — must be zero errors
npm run build            # Rspack build (host + webview)
```

## Critical Rules

1. **The extension has NO IR types.** All IR knowledge (Bundle, Module, Binding, etc.) lives in the Go CLI. The extension only uses RenderModel types from `webview/types/render.ts`.
2. All canvas mutations go through the CLI via JSON-RPC (`action/*` methods). The extension never modifies state directly.
3. File I/O (canvas persistence, protobuf encoding) is handled by the CLI via `session/open`, `session/save`, `session/close`.
4. Two Rspack entries — do not import VS Code APIs in webview code or DOM APIs in host code.
5. The `CanvasEngine` interface (`webview/engine.ts`) is the contract between webview and CLI — all operations are async RPC calls.
6. Auth is runtime-swappable via `auth/status`, `auth/login`, `auth/logout` RPC methods. The `lace.login` command lets users authenticate from VS Code. `ServerManager` emits `'auth'` events after init and login.

## Architecture

| Layer          | Directory                                                                                                 | Environment                |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| Extension host | `extension.ts`, `createWebviewPanel.ts`, `ModuleDetailPanel.ts`, `containers-views/`, `utilities/engine/` | Node.js                    |
| Chat           | `chat/participant.ts`, `chat/tools/`, `chat/system-prompt.ts`                                             | Node.js (VS Code Chat API) |
| Webview UI     | `webview/Canvas.tsx`, `webview/components/`, `webview/state/engine-context.ts`                            | Browser                    |
| Engine         | `webview/engine.ts` (interface), `utilities/engine/rpc-client.ts` (implementation)                        | Shared / Node.js           |
| Types          | `types/protocol.ts`, `webview/types/render.ts`                                                            | Shared                     |
| Tests          | `webview/__tests__/`                                                                                      | Vitest                     |

## How to Work on This Codebase

**Diagnose before you fix.** When something is broken, do not patch the
symptom. Before writing any code, answer these three questions out loud:

1. **What is the actual failure?** (Not the error message — the underlying
   state that's wrong.)
2. **Why does this pattern exist?** Read the surrounding code and AGENTS.md
   to understand the design intent before changing it.
3. **Where is the right layer to fix this?** A UI bug might be a missing
   RPC call. An RPC issue might be a CLI handler bug. Fix it at the source.

If a fix requires adding a special case, a flag, a workaround, or the
words "for now" — stop and reconsider. The right fix is usually:

- A new RPC method or action, not a client-side patch
- A type system change that makes the invalid state unrepresentable
- A shared utility, not duplicated logic
- Moving code to a different layer, not adding glue between layers

**Never make a test pass by weakening the assertion.** If a test fails,
the code is wrong, not the test (unless the test itself is clearly outdated
and needs updating to match a deliberate design change — say so explicitly).

See `AGENTS.md` for the full set of invariants, type system docs, protocol
spec, and gotchas. That file is the authoritative reference.
