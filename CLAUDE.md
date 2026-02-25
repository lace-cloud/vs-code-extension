# Lace VS Code Extension

VS Code extension for visually composing Terraform modules. Users browse
modules from a registry sidebar, add them to a ReactFlow canvas, wire
inputs/outputs, configure settings, and generate `.tf` files. The extension
talks to a Go CLI binary (`lace`) over JSON-RPC stdin/stdout.

## Build & Test

```
npm run test:unit        # 225+ unit tests (no binary needed) — run after EVERY change
npm run test:e2e         # 6 tests (requires lace + terraform)
npx tsc --noEmit         # Type-check — must be zero errors
npm run build            # Rspack build (host + webview)
```

## Critical Rules

1. `toBundle` and `fromBundle` in `utils/bundle.ts` are **frozen** — do not modify them
2. Wire format types in `types/ir.ts` are **snake_case matching Go** — never rename
3. Wires are derived, never stored — workspace state must not contain wires
4. Reducer is pure — no mutations, no side effects, explicit spreads only
5. Two Rspack entries — do not import VS Code APIs in webview code or DOM APIs in host code

## Architecture

| Layer          | Directory                                                                                                 | Environment                |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| Extension host | `extension.ts`, `createWebviewPanel.ts`, `ModuleDetailPanel.ts`, `containers-views/`, `utilities/engine/` | Node.js                    |
| Chat           | `chat/participant.ts`, `chat/tools/`, `chat/system-prompt.ts`                                             | Node.js (VS Code Chat API) |
| Webview UI     | `webview/Canvas.tsx`, `webview/components/`, `webview/state/context.ts`                                   | Browser                    |
| Pure logic     | `webview/state/reducer.ts`, `webview/utils/`                                                              | Either (no runtime deps)   |
| Types          | `types/protocol.ts`, `webview/types/`                                                                     | Shared                     |
| Tests          | `webview/__tests__/`                                                                                      | Vitest                     |

## How to Work on This Codebase

**Diagnose before you fix.** When something is broken, do not patch the
symptom. Before writing any code, answer these three questions out loud:

1. **What is the actual failure?** (Not the error message — the underlying
   state that's wrong.)
2. **Why does this pattern exist?** Read the surrounding code and AGENTS.md
   to understand the design intent before changing it.
3. **Where is the right layer to fix this?** A bug in the UI might be a
   missing reducer case. A reducer bug might be a type system gap. Fix it
   at the source, not at the point where it surfaces.

If a fix requires adding a special case, a flag, a workaround, or the
words "for now" — stop and reconsider. The right fix is usually:

- A new reducer action, not a patch to an existing one
- A type system change that makes the invalid state unrepresentable
- A shared utility, not duplicated logic
- Moving code to a different layer, not adding glue between layers

**Never make a test pass by weakening the assertion.** If a test fails,
the code is wrong, not the test (unless the test itself is clearly outdated
and needs updating to match a deliberate design change — say so explicitly).

See `AGENTS.md` for the full set of invariants, type system docs, protocol
spec, and gotchas. That file is the authoritative reference.
