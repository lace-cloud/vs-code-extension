# Lace VS Code Extension

VS Code extension for visually composing Terraform modules. Users browse
modules from a registry sidebar, add them to a ReactFlow canvas, wire
inputs/outputs, configure settings, and generate `.tf` files. The extension
talks to a Go CLI binary (`lace`) over JSON-RPC stdin/stdout.

## Build & Test

```
npm run test:unit        # 95+ unit tests (no binary needed) — run after EVERY change
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

| Layer          | Directory                                                                                                 | Environment              |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------ |
| Extension host | `extension.ts`, `createWebviewPanel.ts`, `ModuleDetailPanel.ts`, `containers-views/`, `utilities/engine/` | Node.js                  |
| Webview UI     | `webview/Canvas.tsx`, `webview/components/`, `webview/state/context.ts`                                   | Browser                  |
| Pure logic     | `webview/state/reducer.ts`, `webview/utils/`                                                              | Either (no runtime deps) |
| Types          | `types/protocol.ts`, `webview/types/`                                                                     | Shared                   |
| Tests          | `webview/__tests__/`                                                                                      | Vitest                   |

See `AGENTS.md` for the full set of invariants, type system docs, protocol
spec, and gotchas. That file is the authoritative reference.
