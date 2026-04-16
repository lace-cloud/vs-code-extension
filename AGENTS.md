# AGENTS.md — Lace VS Code Extension

This document is for coding agents working on the Lace extension. It contains
the architecture, conventions, and constraints you must follow. `CLAUDE.md` is
the quick-start — read this once you're past the overview.

## What This Project Is

Lace VS Code Extension — a visual Terraform composer. Users browse modules
from a registry sidebar, drag them onto a ReactFlow canvas, wire inputs/outputs,
configure settings, and generate `.tf` files. The extension talks to a Go CLI
binary (`lace`) over gRPC on an ephemeral TCP port, authenticated with a bearer
token from the 5-line startup handshake.

The extension is an **opaque rendering layer**. It does not understand Terraform
IR — no Bundle, Module, or Binding types. All IR knowledge lives in the CLI.
The extension receives a `CanvasView` (view model) and renders it. All mutations
go through the CLI via RPC.

The chat sidebar is the primary composition interface. The canvas is a visual
inspection and verification layer.

## Workspace Layout

pnpm workspace with seven packages:

| Package                | Purpose                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `@lace/proto`          | Shared proto messages (generated), render POJOs (`./render`). Per-package converters live locally. |
| `@lace/host`           | Extension host: `LaceTransport` (gRPC-JS), engine lifecycle, canvas/registry/chat view providers   |
| `@lace/canvas`         | Webview UI (React, ReactFlow). `PostMessageEngine` + `ConnectWebEngine` implement `CanvasEngine`.  |
| `@lace/chat-sidebar`   | Chat webview + host controller (agentic tool loop, tools, proactivity)                             |
| `@lace/design-tokens`  | CSS tokens consumed by canvas + chat + Storybook                                                   |
| `@lace/canvas-stories` | Storybook for canvas (component stories + CLI-backed flow stories)                                 |
| `@lace/host-e2e`       | E2E scaffold (Phase G — placeholder)                                                               |

Rspack produces three bundles:

- `out/extension.js` — Node, from `packages/host/src/extension.ts`
- `out/webview.js` — Browser, from `packages/canvas/src/index.tsx`
- `out/chat-sidebar.js` — Browser, from `packages/chat-sidebar/src/webview/index.tsx`

## Build & Test

```bash
pnpm install
pnpm run build                # rspack build (all three bundles)
pnpm run test:unit            # 117 unit tests via vitest
npx tsc --noEmit              # type-check — must be zero errors
pnpm run proto:gen            # regenerate three TS proto outputs

# Storybook
pnpm run storybook              # component stories (no CLI required)
pnpm run dev:storybook-flows    # flow stories with live `lace engine -tags=test`
```

Always run `pnpm run test:unit` after any change. TypeScript must compile with zero errors.

**Proto regeneration:** Always use `pnpm run proto:gen`. Never run `protoc` manually —
the script uses `snakeToCamel=false`, `forceLong=number`, and generates three outputs
(shared messages, host gRPC-JS stubs, canvas generic-definitions with JSON codecs).

## Architecture

### Transport Layer

The extension owns two implementations of `CanvasEngine`:

- **`PostMessageEngine`** (canvas/post-message-engine.ts) — runs in the webview,
  relays `engineCall` postMessages to the host. The host's `LaceTransport` translates
  these into gRPC-JS calls against the CLI. Used in VS Code mode.
- **`ConnectWebEngine`** (canvas/connect-web-engine.ts) — runs in the browser,
  POSTs Connect-JSON over `fetch` directly to the CLI's Connect-Go listener.
  Parses server-streaming Subscribe frames. Used by Storybook flow stories and
  any other browser context that can reach a live CLI.

The `CanvasEngine` interface is identical for both — App.tsx takes `engine: CanvasEngine`
as a prop and works with either.

### Host Side (Node, VS Code API)

- **`extension.ts`** — activation, command registration, view-provider wiring, engine lifecycle
- **`transport.ts`** — `LaceTransport` class; gRPC-JS client; bearer-token auth via metadata; proto→render converters
- **`server-manager.ts`** — spawns `lace engine`; watches for exit; restarts on failure; emits handshake
- **`engine-process.ts`** — parses the 5-line handshake (`LACE_ENGINE_VERSION/PROTOCOL_VERSION/PORT/TOKEN/READY`) from CLI stdout
- **`canvas-panel.ts`** — canvas webview panel; routes webview messages; starts Subscribe stream for live StateUpdated
- **`registry-sidebar.ts`** — WebviewViewProvider for the registry browse panel
- **`module-detail-panel.ts`** — detail tab for inspecting a registry module
- **`webview-html.ts`** — shared HTML scaffold (CSP, nonce, script include) — used by canvas panel and chat sidebar
- **`subscribe.ts`** — gRPC Subscribe stream handler (StateUpdated + Generate events)
- **`rpc-errors.ts`** — `requireClient` guard + error classification
- **`types.ts`** — host-specific types (`EngineHandshake`, `ServerState`, `WebviewToHost`, `RegistryModule`); re-exports render types from `@lace/proto`

### Webview: Canvas (React, Browser)

- **`App.tsx`** — root. Takes `engine: CanvasEngine` + `hostBridge: HostBridge`. Subscribes to `engine.onEvent` for state updates; routes Canvas events through hostBridge.
- **`index.tsx`** — VS Code entry. Constructs `PostMessageEngine(acquireVsCodeApi())` + a `HostBridge` wrapping `vscode.postMessage`, renders `<App>`.
- **`Canvas.tsx`** — `CompositeEditor` (ReactFlow viewport) + `Canvas` orchestrator. Most logic in focused hooks.
- **`engine.ts`** — `CanvasEngine` interface + `EngineEvent` union (`stateUpdated` / `generateProgress` / `generateSuccess` / `generateError`).
- **`post-message-engine.ts`** — PostMessage-based `CanvasEngine`. Translates host `loadState` / `generate*` messages into EngineEvents.
- **`connect-web-engine.ts`** — Connect-JSON fetch-based `CanvasEngine`. Parses Subscribe stream frames into EngineEvents.
- **`hooks/`** — `useToast`, `useContextMenu`, `useUndoRedo`, `useEdgeInspector`, `useGenerationStatus` (subscribes to `engine.onEvent`), `useNewNodeTracking`, `useClipboard`, `useGroupLogic`, `useSaveState`, `useWindowEvent`
- **`components/`** — `ModuleNode`, `GroupNode`, `ActionBar`, `SlidePanel`, `Toast`, `ContextMenu`, settings panels, `ErrorBoundary`
- **`events.ts`** — centralized `CANVAS_EVENTS` for in-canvas window events (`SAVE`, `GENERATE`, `OPEN_FILE`, `CONTEXT_MENU`, etc.)

### Webview: Chat Sidebar

- **`host/view-provider.ts`** — `ChatViewProvider` implements `vscode.WebviewViewProvider`, creates `ChatController`
- **`host/controller.ts`** — `ChatController`; agentic loop (MAX_TOOL_ROUNDS=25); tool dispatch; AbortController cancellation; history persistence via workspaceState
- **`host/tool-registry.ts`** — `registerTool(schema, handler)` + `getToolSchemas()`
- **`host/tools/`** — tool groups: registry, graph-read, graph-write, workspace, generate
- **`host/history-codec.ts`** — serialize/hydrate `LanguageModelChatMessage[]` for persistence
- **`host/proactivity/`** — pure rule matchers (no vscode deps); `proactivity.ts` wires them into Subscribe stream
- **`webview/App.tsx`** — React root for the chat UI

## Protocol

Host ↔ webview messages live in `@lace/proto` (`HostToWebview`) and host's
`types.ts` (`WebviewToHost`). They're discriminated unions keyed on `command`.

### Host → Webview (`HostToWebview`)

| Command            | Payload                                         | Purpose                             |
| ------------------ | ----------------------------------------------- | ----------------------------------- |
| `loadState`        | `state: CanvasView`                             | Full view model to render           |
| `generateProgress` | `phase: GeneratePhase`                          | Step-by-step generate progress      |
| `generateSuccess`  | `files?: string[]`                              | Generation succeeded                |
| `generateError`    | `message: string`, `diagnostics?: Diagnostic[]` | Generation failed                   |
| `engineResult`     | `requestId`, `result?`, `error?`                | Response to an `engineCall` request |

### Webview → Host (`WebviewToHost`)

| Command        | Payload                          | Purpose                               |
| -------------- | -------------------------------- | ------------------------------------- |
| `webviewReady` | (none)                           | Webview ready for `loadState`         |
| `engineCall`   | `requestId`, `method`, `params?` | RPC call forwarded to CLI engine      |
| `markDirty`    | (none)                           | Canvas has unsaved changes            |
| `markClean`    | (none)                           | Canvas is clean (matches saved state) |
| `openFile`     | `relativePath, line?, column?`   | Open generated .tf file in editor     |

## Engine Interface (`CanvasEngine`)

Defined in `packages/canvas/src/engine.ts`. Both transport implementations conform.

- **Session:** `sessionOpen`, `sessionSave`, `sessionClose`, `sessionGenerate`
- **Registry:** `placeModule` (single RPC — replaces the old `registryGetVersion` + `dropBundle` pair)
- **Actions (return CanvasView):** `connect`, `autoConnect`, `disconnect`, `updateInput`, `updateAllInputs`, `renameInstance`, `deleteInstance`, `copyInstances`, `setVariables`, `setExports`, `setLocals`, `undo`, `redo`
- **Actions (void):** `syncLayout`, `setTerraform`, `setProviders`, `setDependsOn`, `setEnvironments`
- **Groups:** `createGroup`, `updateGroup`, `deleteGroup`
- **Queries:** `queryNodeConfig`, `queryEdgeConfig`, `querySettings`, `queryGraphSummary`, `queryValidate`
- **Events:** `onEvent(listener)` — subscribes to `EngineEvent` (`stateUpdated` / `generateProgress` / `generateSuccess` / `generateError`). Both engines implement this; consumers (App, `useGenerationStatus`) use a single API regardless of transport.
- **Streaming (ConnectWebEngine only):** `startSubscribe()` — opens the Subscribe stream and emits StateUpdated/GenerateProgress/Success/Error as EngineEvents.

Auth is handled implicitly by the CLI process. The extension does not expose auth methods.

## Type System

### Render types (`@lace/proto/render` — single source)

```
CanvasView { module_name, nodes: RenderNode[], edges: RenderEdge[], errors: RenderError[], groups: RenderGroup[], can_undo, can_redo, is_dirty }
RenderNode { id, label, kind, module_key?, icon_url?, position, has_errors, error_messages, inputs: NodePin[], outputs: NodePin[] }
RenderEdge { id, source, target, source_output, target_input }
RenderGroup { id, label, node_ids: string[], collapsed }
NodePin { name, type, type_family?, required?, wired?, description?, sensitive? }
```

Query response types: `NodeConfig`, `EdgeConfig`, `SettingsConfig`, `RenderError`, `Diagnostic`, `GeneratePhase`.

### Proto message types and converters

Each package has its own `./generated/service.ts` because ts-proto emits
service stubs differently per output (gRPC-JS for host, generic-definitions

- JSON codecs for canvas). Message interfaces are structurally identical
  across outputs; enums (`NodeKind`, `InputMode`, `DiagnosticSeverity`) are
  nominally distinct per output.

A single set of proto→render converters lives in `@lace/proto/converters`.
It accepts structural input aliases (`@lace/proto/proto-shapes`) that widen
the enum fields to `number`, so host-generated and canvas-generated proto
messages are both assignable via TypeScript's structural + numeric-enum-
widening rules. Both `LaceTransport` (host) and `ConnectWebEngine` (canvas)
import converters from `@lace/proto` — no duplication.

### Context state (canvas)

```
CanvasState { view: CanvasView | null, loading: boolean, error: string | null, generation: number }
```

## Critical Invariants

1. **Extension is a rendering layer.** No IR knowledge, no Terraform parsing, no HCL type inference, no cloud provider logic, no identifier validation.
2. **All mutations go through `CanvasEngine`.** Webview calls methods, transport RPCs the CLI. Never modify state directly.
3. **`CanvasView` is the single source of truth** for what gets rendered. The CLI projects IR into this view model.
4. **`generation` counter controls fitView.** `CompositeEditor` remounts when `generation` changes (via React `key`), triggering `fitView` on fresh state loads.
5. **Dirty tracking flows from CLI.** `is_dirty` is a field on `CanvasView`. The webview posts `markDirty`/`markClean` to the host.
6. **Auto-save fires ~2s after last edit** (debounced in canvas-panel.ts). Don't add additional debouncing elsewhere.
7. **Auth is owned by the CLI.** No auth methods on `CanvasEngine`. The bearer token from the handshake is attached to every RPC.
8. **All RPC from webview goes through the host.** Except in ConnectWebEngine flows (Storybook), where the browser talks directly to the CLI's Connect listener.
9. **Three Rspack entries.** Don't import VS Code APIs in webview code or DOM APIs in host code.
10. **Registry browsing is host-side.** The webview never fetches registry data directly; the host calls `listRegistryModules` via `LaceTransport`.
11. **Window events use centralized constants.** All custom event names are in `packages/canvas/src/events.ts` (`CANVAS_EVENTS`).

## Testing

### Unit Tests (vitest, 117 tests)

Canvas (`packages/canvas/src/__tests__/`):

- `handleId.test.ts`, `duplicates.test.ts` — utility functions
- `useSaveState`, `useToast`, `useClipboard`, `useGenerationStatus`, `useGroupLogic` — hook tests (jsdom/happy-dom)
- `connect-web-engine.test.ts` — Connect-JSON unary + streaming frame parser

Chat sidebar (`packages/chat-sidebar/src/__tests__/`):

- `chat-tools.test.ts`, `registry-tools.test.ts` — tool contract tests
- `history-codec.test.ts` — persistence round-trip
- `canvas-summary.test.ts` — canvas state formatter
- `proactivity-rules.test.ts` — pure rule matchers

### Storybook

Two tiers:

- **Component stories** (Phase E1) — pure-prop rendering of `Toast`, `SlidePanel`, `ContextMenu`, `ModuleNode`, `GroupNode`. No CLI needed.
- **Flow stories** (Phase E2+F) — mount full `<App>` with a live `lace engine` built via `make build-test`. Stories pass `fixtureName` to the `FlowDecorator`, which calls `engine.testSessionOpen(fixtureName)` to load a deterministic embedded seed. 5 fixtures: `empty`, `iam-role`, `iam-stack`, `wired-stack`, `collapsed-group`. Launched via `pnpm run dev:storybook-flows`.

### Playwright flow tests (Phase F)

Golden-path visual regression tests under `tests/flow/`:

- `canvas-golden-paths.spec.ts` — 5 tests, one per flow story. Each navigates to the Storybook iframe URL, waits for `[data-flow-ready]` (rendered by FlowDecorator once boot completes), asserts key DOM, captures a screenshot baseline.
- `seed-manifest.spec.ts` — pre-flight canary. Reads `$LACE_CLI_REPO/internal/module/server/testdata/seeds/*.sha256` and compares to `tests/flow/__snapshots__/seed-manifest.json`. Fails fast with a clear "hash mismatch" message if upstream `.lace` seeds have shifted.

Configuration (`playwright.config.ts`):

- Pinned viewport 1440×900, DPR 1, `en-US`, `UTC`, `colorScheme: 'dark'`
- `maxDiffPixelRatio: 0.005` (0.5%)
- `snapshotPathTemplate` includes `{platform}` so Darwin baselines never overwrite Linux
- `webServer: 'pnpm run dev:storybook-flows'` spawns CLI + Storybook together

Baselines are **only authoritative from the pinned container** (`mcr.microsoft.com/playwright:v1.59.1-jammy`). Local `*-darwin.png` artefacts are gitignored.

Drift-badge test intentionally absent — `pb.RenderNode` has no drift metadata field yet. When lace-cli extends the proto + ships a `drift-overlay.lace` fixture, a 6th test + story land as a followup.

### E2E (Phase G — scaffold only)

`packages/host-e2e` is reserved for `@vscode/test-electron` smoke tests (activation, command registration, sidebar view provider). Not yet populated.

## Common Gotchas

- **PostMessage is async and untyped at runtime.** `WebviewToHost` / `HostToWebview` are contracts; at runtime, messages are plain objects. Handle unknown fields defensively.
- **`generation` must increment on every `loadState`** or fitView won't trigger.
- **`is_dirty` comes from the CLI**, not tracked locally. Webview posts `markDirty`/`markClean`.
- **Keyboard shortcuts are HTML-level** (in `canvas-panel.ts`'s prebody script). They call globals (`__canvasUndo`, etc.) set by canvas hooks.
- **ReactFlow v12** (`@xyflow/react`). Node components receive `NodeProps<Node<TData, TType>>`.
- **Tailwind CSS v4** for styling.
- **`engineResult` routing.** Only PostMessageEngine's pending calls resolve through this bridge; ConnectWebEngine uses fetch directly.
- **ts-proto JSON output uses camelCase** on the wire even with `snakeToCamel=false` (which affects TS interface field names). ConnectWebEngine's `toJSON`/`fromJSON` handles this; tests assert camelCase wire format.
- **Proto regeneration.** Always use `pnpm run proto:gen` — it generates three outputs with specific ts-proto options per output.

## Style Guide

- TypeScript strict mode. No `any` except at RPC boundaries. Zero `as any` in new code.
- Function components with hooks. No class components.
- Descriptive test names stating behavior, not implementation.
- No dead code. Every export is consumed. `npx tsc --noEmit` — zero errors.
- Hook tests use `renderHook` + `act()` with `// @vitest-environment happy-dom` header.

## Dependencies

**Runtime (extension):** `@grpc/grpc-js`, `react`, `react-dom`, `@xyflow/react`.

**Dev:** `typescript`, `vitest`, `@testing-library/react`, `happy-dom`, `@rspack/cli`,
`tailwindcss`, `postcss`, `@biomejs/biome`, `husky`, `lint-staged`, `ts-proto`, `storybook` +
`storybook-react-rsbuild`, `@rsbuild/core`.

**Zero native Node.js modules.** The CLI handles all heavy lifting (terraform exec,
IR manipulation, registry HTTP). The extension is pure JavaScript.
