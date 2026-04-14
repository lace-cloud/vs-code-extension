# Lace VS Code Extension

VS Code extension for visually composing Terraform modules. Users browse
modules from a registry sidebar, add them to a ReactFlow canvas, wire
inputs/outputs, configure settings, and generate `.tf` files. The extension
talks to a Go CLI binary (`lace`) over gRPC on an ephemeral TCP port.

The chat (`@lace`) is the primary composition interface. The canvas is a
visual inspection and verification layer.

## Build & Test

```
npm run test:unit        # 63 unit tests (no binary needed) — run after EVERY change
npm run test:e2e         # 15 E2E tests (requires lace + terraform)
npx tsc --noEmit         # Type-check — must be zero errors
npm run build            # Rspack build (host + webview)
npm run proto:gen        # Regenerate TypeScript proto from proto/service.proto
```

## Critical Rules

1. **The extension has NO IR types.** All IR knowledge (Bundle, Module, Binding, etc.) lives in the Go CLI. The extension only uses RenderModel types from `webview/types/render.ts`.
2. All canvas mutations go through the CLI via gRPC (`action/*` methods). The extension never modifies state directly.
3. File I/O (canvas persistence, protobuf encoding) is handled by the CLI via `session/open`, `session/save`, `session/close`.
4. Two Rspack entries — do not import VS Code APIs in webview code or DOM APIs in host code.
5. The `CanvasEngine` interface (`webview/engine.ts`) is the contract between webview and CLI — all operations are async RPC calls.
6. Auth is runtime-swappable via `auth/status`, `auth/login`, `auth/logout` RPC methods. The `lace.login` command lets users authenticate from VS Code. `ServerManager` emits `'auth'` events after init and login.
7. **No domain knowledge in the extension.** No Terraform parsing, no HCL type inference, no cloud provider logic, no identifier validation. If you need domain logic, add an RPC to the CLI.
8. **Chat is the primary interface.** The system prompt drives composition through clarification-first workflows. "Solve with Lace" was removed — users talk directly to the chat.

## Architecture

| Layer          | Directory                                                                                                 | Environment                |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| Extension host | `extension.ts`, `createWebviewPanel.ts`, `ModuleDetailPanel.ts`, `containers-views/`, `utilities/engine/` | Node.js                    |
| Chat           | `chat/participant.ts`, `chat/tools/`, `chat/system-prompt.ts`, `chat/utils/`                              | Node.js (VS Code Chat API) |
| Webview UI     | `webview/Canvas.tsx`, `webview/components/`, `webview/hooks/`, `webview/state/`                           | Browser                    |
| Engine         | `webview/engine.ts` (interface), `utilities/engine/grpc-client.ts` (implementation)                       | Shared / Node.js           |
| Types          | `types/protocol.ts`, `webview/types/render.ts`                                                            | Shared                     |
| Events         | `webview/events.ts`                                                                                       | Browser                    |
| Tests          | `webview/__tests__/`                                                                                      | Vitest                     |

### Canvas Decomposition

`Canvas.tsx` contains `CompositeEditor` (ReactFlow viewport) and the `Canvas` orchestrator. Most logic is extracted into focused hooks:

| Hook                  | Responsibility                                |
| --------------------- | --------------------------------------------- |
| `useToast`            | Toast notifications with auto-dismiss timing  |
| `useContextMenu`      | Right-click context menu state                |
| `useUndoRedo`         | Undo/redo with position forcing               |
| `useEdgeInspector`    | Edge selection and deletion                   |
| `useGenerationStatus` | Generate progress, validation errors          |
| `useNewNodeTracking`  | Blue border for newly added nodes, auto-zoom  |
| `useClipboard`        | Copy/cut/paste with engine integration        |
| `useSaveState`        | Shared save state machine for settings panels |
| `useWindowEvent`      | Window event listener with cleanup            |

### Chat Tools

| Tool                                 | Purpose                                           |
| ------------------------------------ | ------------------------------------------------- |
| `lace_search_registry`               | Search modules by keyword, system, category       |
| `lace_inspect_module`                | Full input/output schema (searches all user orgs) |
| `lace_describe_graph`                | Current canvas state                              |
| `lace_validate_graph`                | Validation errors with per-input detail           |
| `lace_inspect_node`                  | Live bindings of a placed instance                |
| `lace_get_settings`                  | Terraform block, providers, locals, environments  |
| `lace_workspace_context`             | Project analysis with structured ProjectProfile   |
| `lace_add_module`                    | Add module (fuzzy match, multi-org search)        |
| `lace_remove_module`                 | Remove instance                                   |
| `lace_connect` / `lace_auto_connect` | Wire modules                                      |
| `lace_disconnect`                    | Remove a wire                                     |
| `lace_set_input`                     | Set literal, variable, or expression binding      |
| `lace_rename_instance`               | Rename (cascades references)                      |
| `lace_set_variable`                  | Canvas-level var.NAME                             |
| `lace_set_local`                     | Add/update local value (read-merge-write)         |
| `lace_set_environment`               | Per-environment variable overrides                |
| `lace_undo`                          | Undo last change                                  |
| `lace_generate`                      | Generate .tf files                                |

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

**Proto changes:** Always use `npm run proto:gen` to regenerate TypeScript
proto code. Never hand-edit generated files or run `protoc` manually with
guessed options. The script uses `snakeToCamel=false` to preserve field names.

See `AGENTS.md` for the full set of invariants, type system docs, protocol
spec, and gotchas. That file is the authoritative reference.
