# AGENTS.md -- Lace VS Code Extension

This document is for AI coding agents working on the Lace codebase. It contains the architecture, conventions, and constraints you must follow.

## What This Project Is

Lace VS Code Extension -- a visual Terraform composer. Users browse modules from a registry sidebar, drag them onto a ReactFlow canvas, wire inputs/outputs, configure settings, and generate `.tf` files. The extension talks to a Go CLI binary (`lace`) over gRPC on an ephemeral TCP port.

The extension is an **opaque rendering layer**. It does NOT understand Terraform IR -- no Bundle, no Module, no Binding types. All IR knowledge lives in the CLI. The extension receives a `CanvasView` (a view model of nodes, edges, errors) from the CLI and renders it. All mutations go through the CLI via RPC.

The chat (`@lace`) is the **primary composition interface**. The canvas is a visual inspection and verification layer. The system prompt drives a clarification-first workflow where the chat asks about the project before suggesting infrastructure.

## Build & Test

```bash
npm run compile          # Rspack build (host + webview)
npm run test:unit        # 63 unit tests (vitest, no binary needed)
npm run test:e2e         # 15 E2E tests (requires lace + terraform binaries)
npm run test:watch       # Watch mode (unit tests)
npx tsc --noEmit         # Type-check only -- must be zero errors
npm run proto:gen        # Regenerate TypeScript proto (canonical command)
```

Always run `npm run test:unit` after any change. All 63 unit tests must pass. TypeScript must compile with zero errors.

E2E tests spawn a real `lace module serve` process and exercise the full gRPC transport. They require the `lace` binary and `terraform` to be installed. Set `LACE_BINARY=/path/to/lace` to override the default PATH lookup.

**Proto regeneration:** Always use `npm run proto:gen`. Never run `protoc` manually -- the script uses `snakeToCamel=false` and other options that must match the codebase conventions.

## Release Process

This project uses **developer-initiated versioning with automated publishing**. The developer decides when and what to release; CI handles the rest.

### Quick Release

```bash
# From main branch, after your changes are pushed
npm version patch --no-git-tag-version   # Bump version in package.json + package-lock.json
git add package.json package-lock.json
git commit -m "X.X.X"
git push origin main
# Release workflow detects version change → tags → publishes to Marketplace → creates GitHub Release
```

**Important:** Do not push tags manually. The Release workflow creates the tag. Pushing `--tags` causes the workflow to fail with "tag already exists."

### Version Guidelines

| Change Type     | Example        | Version Bump            |
| --------------- | -------------- | ----------------------- |
| Bug fix         | Fix wiring bug | `patch` (0.0.1 → 0.0.2) |
| New feature     | Add new panel  | `minor` (0.0.1 → 0.1.0) |
| Breaking change | Remove command | `major` (0.0.1 → 1.0.0) |

### CI/CD Workflows

| Workflow | File                            | Trigger                          | Purpose                                            |
| -------- | ------------------------------- | -------------------------------- | -------------------------------------------------- |
| CI       | `.github/workflows/ci.yml`      | PRs, branch pushes               | Run tests, verify version sync                     |
| Release  | `.github/workflows/release.yml` | Push to main with version change | Tag, publish to marketplace, create GitHub release |

## Architecture Overview

### Host side (Node.js, VS Code API)

- **`extension.ts`** -- activation, command registration, server lifecycle, `lace.login` command, org selection, passes `selectedOrg` through all module-add paths
- **`createWebviewPanel.ts`** -- manages canvas panel lifecycle, routes PostMessage between webview and CLI RPC, handles auto-save (debounced ~2s), dirty tracking, module drops from sidebar (with org provenance), generate orchestration (delegates format + validate to CLI). Canvas state (`latestCanvasView`) persists after panel disposal so the chat can reference it.
- **`server-manager.ts`** -- manages the CLI engine server process (`lace module serve`), spawns/restarts the child process, reads `LACE_GRPC_PORT=<port>` from stdout, exposes `rpcClient` (gRPC `LaceClient`), checks auth status after init (emits `'auth'` event)
- **`grpc-client.ts`** -- gRPC client wrapping the generated `LaceEngineClient`, promisifies callbacks, converts proto types to extension render types. Uses `createEnumConverter` factory for enum mappings. `dropBundle` accepts optional `organization` for org provenance tracking.
- **`RegistrySidebarProvider.ts`** -- WebviewViewProvider for the registry sidebar, fetches modules from `DEFAULT_SYSTEMS` (centralized constant), posts `addToCanvas` messages to canvas
- **`ModuleDetailPanel.ts`** -- detail tab for inspecting registry modules

### Webview side (React, browser environment)

- **`App.tsx`** -- root component, creates `PostMessageEngine`, listens for `HostToWebview` messages, uses `useWindowEvent` for custom event listeners
- **`Canvas.tsx`** -- contains `CompositeEditor` (ReactFlow viewport) and `Canvas` (orchestrator). Most logic extracted into focused hooks.
- **`hooks/`** -- `useToast`, `useContextMenu`, `useUndoRedo`, `useEdgeInspector`, `useGenerationStatus`, `useNewNodeTracking`, `useClipboard`, `useGroupLogic`, `useSaveState`, `useWindowEvent`
- **`events.ts`** -- centralized `CANVAS_EVENTS` constants for all window custom events
- **`components/`** -- `ModuleNode`, `GroupNode`, `ActionBar`, `SlidePanel`, `Toast`, `ContextMenu`, `SaveButton`, `ValidationErrorBanner`, `ErrorBoundary`, settings panels
- **`engine-context.ts`** -- React context providing `CanvasState` + `CanvasEngine` + `updateView`
- **`post-message-engine.ts`** -- implements `CanvasEngine` by sending postMessages to the host

### Chat participant (`@lace`)

- **`chat/participant.ts`** -- registration + agentic tool loop (up to 25 rounds). Injects fresh canvas state every turn (with RPC fallback when panel is closed). Improved stuck detection with per-tool guidance.
- **`chat/tools/`** -- six tool groups: registry, graph-read, graph-write, workspace, generate, settings (lace_set_local, lace_set_environment)
- **`chat/system-prompt.ts`** -- `buildSystemPrompt(systems)` factory. Chat-first model: clarification before action, ProjectProfile guidance, validation error handling, input value heuristics.
- **`chat/utils/canvas-summary.ts`** -- shared `formatCanvasState(view, opts)` for compact and detailed canvas summaries

## Protocol

Defined in `src/types/protocol.ts`. Messages are discriminated unions on `command`.

### Host to Webview (`HostToWebview`)

| Command            | Payload                                         | Purpose                             |
| ------------------ | ----------------------------------------------- | ----------------------------------- |
| `loadState`        | `state: CanvasView`                             | Send full view model to render      |
| `generateProgress` | `phase: GeneratePhase`                          | Step-by-step generate progress      |
| `generateSuccess`  | `files?: string[]`                              | Generation succeeded                |
| `generateError`    | `message: string`, `diagnostics?: Diagnostic[]` | Generation failed                   |
| `engineResult`     | `requestId: string`, `result?`, `error?`        | Response to an `engineCall` request |

### Webview to Host (`WebviewToHost`)

| Command        | Payload                                  | Purpose                                    |
| -------------- | ---------------------------------------- | ------------------------------------------ |
| `webviewReady` | (none)                                   | Webview initialized, ready for `loadState` |
| `engineCall`   | `requestId: string`, `method`, `params?` | RPC call forwarded to CLI engine           |
| `markDirty`    | (none)                                   | Canvas has unsaved changes                 |
| `markClean`    | (none)                                   | Canvas is clean (matches saved state)      |
| `openFile`     | `relativePath, line?, column?`           | Open generated .tf file in editor          |

## Engine Interface

`CanvasEngine` in `src/webview/engine.ts` defines what the webview can ask the host to do. `PostMessageEngine` implements it by sending `engineCall` postMessages.

**Session methods:** `sessionOpen`, `sessionSave`, `sessionClose`, `sessionGenerate`

**Action methods (return updated `CanvasView`):** `dropBundle`, `connect`, `autoConnect`, `disconnect`, `updateInput`, `updateAllInputs`, `renameInstance`, `deleteInstance`, `copyInstances`, `createGroup`, `updateGroup`, `deleteGroup`, `setVariables`, `setExports`, `setLocals`, `undo`, `redo`

**Action methods (void):** `syncLayout`, `setTerraform`, `setProviders`, `setDependsOn`, `setEnvironments`

**Query methods:** `queryNodeConfig`, `queryEdgeConfig`, `querySettings`, `queryGraphSummary`, `queryValidate`

**Auth methods (always available, no API client required):** `authStatus`, `authLogin`, `authLogout`

## Type System

### `CanvasView` (render.ts) -- the view model

```
CanvasView { module_name, nodes: RenderNode[], edges: RenderEdge[], errors: RenderError[], groups: RenderGroup[], can_undo, can_redo, is_dirty }
RenderNode { id, label, kind, module_key?, icon_url?, position, has_errors, error_messages, inputs: NodePin[], outputs: NodePin[] }
RenderEdge { id, source, target, source_output, target_input }
RenderGroup { id, label, node_ids: string[], collapsed }
NodePin { name, type, type_family?, required?, wired?, description?, sensitive? }
```

### Query response types (render.ts)

- `NodeConfig` -- inputs, outputs, siblings, depends_on for a node config panel
- `EdgeConfig` -- source outputs + target unbound inputs for edge config panel
- `SettingsConfig` -- terraform, providers, locals, environments

### Protocol types (protocol.ts)

- `HostToWebview`, `WebviewToHost` -- message unions
- `GeneratePhase` -- `'generating' | 'formatting' | 'validating'`
- `Diagnostic` -- RPC validation diagnostic (severity, message, instance_id?, address?, file, line, column)
- `RegistryModule` -- shared across sidebar and detail panel

### Context state (engine-context.ts)

```
CanvasState { view: CanvasView | null, loading: boolean, error: string | null, generation: number }
```

## File Organization

| Layer           | Path                                          | Purpose                                                                  |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Entry point     | `extension.ts`                                | Activation, command registration                                         |
| Host: canvas    | `webview/createWebviewPanel.ts`               | Panel lifecycle, PostMessage routing, auto-save                          |
| Host: HTML      | `webview/getWebviewContent.ts`                | Webview HTML shell, keyboard handlers                                    |
| Host: detail    | `webview/ModuleDetailPanel.ts`                | Registry module detail tab                                               |
| Host: sidebar   | `containers-views/RegistrySidebarProvider.ts` | Registry sidebar provider                                                |
| Host: engine    | `utilities/engine/server-manager.ts`          | CLI process lifecycle                                                    |
| Host: RPC       | `utilities/engine/grpc-client.ts`             | gRPC client (LaceClient)                                                 |
| Host: errors    | `utilities/engine/rpc-errors.ts`              | RPC error handling helpers                                               |
| Webview: root   | `webview/App.tsx`                             | Message listener, engine creation, context                               |
| Webview: canvas | `webview/Canvas.tsx`                          | CompositeEditor + Canvas orchestrator                                    |
| Webview: hooks  | `webview/hooks/`                              | useToast, useClipboard, useUndoRedo, etc.                                |
| Webview: events | `webview/events.ts`                           | CANVAS_EVENTS constants                                                  |
| Webview: engine | `webview/engine.ts`                           | CanvasEngine interface                                                   |
| Webview: impl   | `webview/post-message-engine.ts`              | PostMessageEngine (CanvasEngine over postMessage)                        |
| Webview: state  | `webview/state/engine-context.ts`             | React context (CanvasState + engine)                                     |
| Webview: types  | `webview/types/render.ts`                     | CanvasView, RenderNode, RenderEdge, configs                              |
| Shared types    | `types/protocol.ts`                           | HostToWebview, WebviewToHost, Diagnostic                                 |
| Components      | `webview/components/`                         | ModuleNode, GroupNode, panels, ActionBar, Toast, ContextMenu, SaveButton |
| Utilities       | `webview/utils/`                              | duplicates, handleId, layout                                             |
| Styles          | `webview/styles/panel.ts`                     | Shared panel style constants                                             |
| Chat            | `chat/`                                       | @lace chat participant, tools, system prompt, utils                      |
| Chat utils      | `chat/utils/canvas-summary.ts`                | Shared canvas state formatter                                            |
| Proto           | `proto/service.proto`                         | gRPC service definition (source of truth)                                |
| Generated       | `src/generated/proto/service.ts`              | Generated TS proto (via `npm run proto:gen`)                             |
| Tests           | `webview/__tests__/`                          | Unit + E2E tests                                                         |

## Testing

### Unit Tests (63 tests, no binary needed)

| File                          | What it tests                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `chat-tools.test.ts`          | Chat tools: add module, set input, validate, generate, auto-connect, set local, set environment, org provenance (19 tests) |
| `registry-tools.test.ts`      | Registry search and inspect (5 tests)                                                                                      |
| `grpc-client-org.test.ts`     | Org context propagation on gRPC calls (8 tests)                                                                            |
| `useSaveState.test.ts`        | Save state machine hook (3 tests, jsdom)                                                                                   |
| `useToast.test.ts`            | Toast auto-dismiss timing (5 tests, jsdom)                                                                                 |
| `useClipboard.test.ts`        | Copy/cut/paste with engine (4 tests, jsdom)                                                                                |
| `useGenerationStatus.test.ts` | Generation progress events (5 tests, jsdom)                                                                                |
| `duplicates.test.ts`          | Duplicate index detection utility (5 tests)                                                                                |
| `handleId.test.ts`            | Handle ID parsing utility (5 tests)                                                                                        |
| `canvas-summary.test.ts`      | Canvas state formatter (4 tests)                                                                                           |

### E2E Tests (15 tests, requires lace + terraform)

| File                 | What it tests                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `e2e-canvas.test.ts` | Canvas workflows: session lifecycle, module placement, wiring, undo/redo, persistence, generation (9 tests)             |
| `e2e-chat.test.ts`   | Chat workflows: search+add, nonexistent module error, settings, environments, validation+undo, describe graph (6 tests) |
| `e2e-helpers.ts`     | Shared: binary resolution, server spawn, fixture loading, chat tool registration                                        |

## Critical Invariants

1. **Extension is a rendering layer.** No IR knowledge, no Terraform parsing, no HCL type inference, no cloud provider logic, no identifier validation. The extension receives `CanvasView` and renders it.

2. **All mutations go through engine interface.** Webview calls `CanvasEngine` methods, `PostMessageEngine` sends `engineCall` postMessages to the host, host forwards to CLI via gRPC. Never modify state directly.

3. **`CanvasView` is the single source of truth** for what gets rendered. The CLI projects IR into this view model.

4. **`generation` counter controls fitView.** `CompositeEditor` remounts when `generation` changes (via React `key`), triggering `fitView` on fresh state loads.

5. **Dirty tracking flows from CLI.** `is_dirty` is a field on `CanvasView` set by the CLI engine. The webview posts `markDirty`/`markClean` to the host for VS Code's document dirty indicator.

6. **Auto-save in host fires ~2s after last edit** (debounced). Don't add additional debouncing in the webview.

7. **Canvas state persists after panel disposal.** `latestCanvasView` is NOT cleared when the panel closes, so the chat can reference the last-known state. It's replaced on next session open.

8. **All RPC to CLI goes through the host's server-manager**, never directly from the webview. The webview only talks to the host via postMessage.

9. **Two Rspack entries.** `out/extension.js` (Node.js, CommonJS) and `out/webview.js` (browser). Don't import VS Code APIs in webview code or DOM APIs in host code.

10. **Registry browsing is host-side.** The webview never fetches registry data. Module drops arrive as `loadState` messages from the host after the host calls `action/drop_bundle` via gRPC.

11. **Window events use centralized constants.** All custom event names are in `webview/events.ts` (`CANVAS_EVENTS`). Never use string literals for event names (except in `getWebviewContent.ts` HTML which can't import TypeScript).

12. **Window globals are typed.** `__canvasUndo`, `__canvasCopy`, `__canvasCut`, `__canvasPaste` are declared in `src/global.d.ts`. No unsafe `as unknown as Record` casts.

13. **Org provenance flows through `dropBundle`.** When adding a module, the extension passes the `organization` to the CLI's `DropBundleRequest` so the CLI can track which registry the module came from.

## Common Gotchas

- **PostMessage is async and untyped at runtime.** `protocol.ts` types are the contract -- runtime messages are plain objects. Always handle unknown/missing fields defensively in message handlers.

- **`generation` must increment on every `loadState`** or fitView won't trigger, because `CompositeEditor` uses it as a React `key`.

- **`is_dirty` comes from the CLI engine**, not tracked locally. The webview reads it from `CanvasView` and posts `markDirty`/`markClean` to the host.

- **Window keyboard shortcuts are in `getWebviewContent.ts`** HTML, not React. Canvas hooks expose globals (`__canvasUndo`, `__canvasCopy`, etc.) that the HTML-level listeners call.

- **ReactFlow v12.** This project uses `@xyflow/react` v12. Node components receive `NodeProps<Node<TData, TType>>`.

- **Tailwind CSS v4** for all styling. No separate CSS files for components.

- **`engineResult` routing.** `App.tsx` receives `engineResult` messages and calls `engine.handleResult()` to resolve the pending promise in `PostMessageEngine`. This is the async RPC bridge.

- **`setLocals` replaces the full array.** The `lace_set_local` chat tool uses a read-merge-write pattern: reads existing locals, merges the new one, sends the combined array.

- **Proto regeneration.** Always use `npm run proto:gen`. The script uses `snakeToCamel=false` — running `protoc` manually with default options will rename every field from `snake_case` to `camelCase` and break the entire codebase.

## Style Guide

- TypeScript strict mode. No `any` except at RPC boundaries.
- Function components with hooks. No class components.
- Descriptive test names that state the behavior, not the implementation.
- No dead code. Every export is consumed. Run `npx tsc --noEmit` -- zero errors.
- Hook tests use `renderHook` + `act()` with jsdom environment (`// @vitest-environment jsdom`).

## Dependencies

**Runtime:** `react`, `react-dom`, `@xyflow/react` -- that's it.

**Dev:** `typescript`, `vitest`, `@testing-library/react`, `jsdom`, `rspack`, `tailwindcss`, `postcss`, `prettier`, `husky`, `lint-staged`, `ts-proto`.

Do not add native dependencies (sqlite3, node-gyp, etc.). The extension has zero native Node.js modules. The CLI handles all heavy lifting.
