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

This repo is a **thin VS Code adapter shell**. The library code lives
in [`lace-cloud/lace`](https://github.com/lace-cloud/lace)
and ships from GitHub Packages.

**In this repo:**

| Path / Package              | Purpose                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `src/`                      | Extension activation, webview entries (canvas + chat), vscode-coupled host primitives (panel classes, HTML scaffold, RPC-error toast) |
| `packages/chat-sidebar/`    | VS Code chat adapter — `ChatViewProvider`, `vscode-adapter`, `vscode-part-codec`, `controller`, tool implementations |
| `packages/host-e2e/`        | `@vscode/test-electron` smoke + command tests                                 |

**Consumed from `@lace-cloud/*` (lives in lace):**

| Package                     | Purpose                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `@lace-cloud/proto`         | Shared proto messages + render POJOs + converters                             |
| `@lace-cloud/host`          | Vscode-free library: `LaceTransport` (gRPC-JS), `ServerManager`, engine handshake, RpcError + classifier |
| `@lace-cloud/canvas`        | Webview UI (React, ReactFlow). `PostMessageEngine` + `ConnectWebEngine` implement `CanvasEngine` |
| `@lace-cloud/chat-core`     | Vscode-free chat machinery (`AgentController`, `ToolRegistry`, proactivity)   |
| `@lace-cloud/chat-webview`  | Pure React chat UI                                                            |
| `@lace-cloud/design-tokens` | CSS tokens + JS exports                                                       |
| `@lace-cloud/ui`            | Design-system primitives (Button, IconButton, Panel, Modal, etc.)             |

Rspack produces three bundles:

- `out/extension.js` — Node, from `src/extension.ts` (extension activation; vscode-coupled host primitives in `src/vscode/`)
- `out/webview.js` — Browser, from `src/canvas-webview-entry.tsx` (mounts `<App>` from `@lace-cloud/canvas`)
- `out/chat-sidebar.js` — Browser, from `src/chat-webview-entry.tsx` (mounts `<App>` from `@lace-cloud/chat-webview`)

## Build & Test

```bash
# NODE_AUTH_TOKEN must be set: any GitHub PAT with read:packages.
# @lace-cloud/* packages are public on GH Packages but the registry
# always requires a token (GH-side quirk).
export NODE_AUTH_TOKEN=<your-pat>
pnpm install
pnpm run build                # rspack build (all three bundles)
pnpm run test:unit            # vitest (chat-sidebar tests)
pnpm run test:host-e2e        # @vscode/test-electron smoke + command tests
pnpm run lint                 # biome check
npx tsc --noEmit              # type-check — must be zero errors
```

**Proto changes** happen in [`lace-cloud/lace`](https://github.com/lace-cloud/lace)
(`pnpm proto:gen` there), then a new `@lace-cloud/*` version is published
and consumers bump deps. This repo doesn't run `protoc` directly.

## Architecture

### Extension shell (this repo)

**`src/` (vscode-coupled, not published):**

- **`extension.ts`** — activation, command registration, view-provider wiring, engine lifecycle
- **`canvas-webview-entry.tsx`** — rspack entry for `out/webview.js`; calls `acquireVsCodeApi()`, constructs `PostMessageEngine` + `HostBridge`, renders `<App>` from `@lace-cloud/canvas`
- **`chat-webview-entry.tsx`** — rspack entry for `out/chat-sidebar.js`; mounts `<App>` from `@lace-cloud/chat-webview`
- **`vscode/canvas-panel.ts`** — canvas WebviewPanel; routes webview messages; starts Subscribe stream
- **`vscode/registry-sidebar.ts`** — registry WebviewViewProvider
- **`vscode/module-detail-panel.ts`** — module detail tab
- **`vscode/webview-html.ts`** — shared HTML scaffold (CSP, nonce, script include)
- **`vscode/rpc-error-ui.ts`** — `vscode.window` toast for classified RPC errors

**`packages/chat-sidebar/` (`@lace-cloud/chat-sidebar`, VS Code chat adapter):**

- **`host/view-provider.ts`** — `ChatViewProvider` implements `vscode.WebviewViewProvider`; takes a `BuildWebviewHtml` callback so the package stays vscode-host-free internally
- **`host/controller.ts`** — wires VS Code adapter + `AgentController` (from `@lace-cloud/chat-core`) + tool registry
- **`host/tools/`** — tool implementations: registry, graph-read, graph-write, workspace, generate (consume `@lace-cloud/host`'s `LaceTransport`)
- **`vscode-adapter.ts`** — implements `ChatHostAdapter` (interface from `@lace-cloud/chat-core`) using `vscode.lm`, `vscode.workspace`, etc.
- **`vscode-part-codec.ts`** — converts between `vscode.LanguageModel*Part` and the chat-core `Part` types
- **`vscode-webview-transport.ts`** — wraps `vscode.Webview` for chat-core's `WebviewTransport` interface

### Library code (in lace, consumed via `@lace-cloud/*`)

These packages live in [`lace-cloud/lace`](https://github.com/lace-cloud/lace).
This repo doesn't own their source. Notable contracts:

- **`@lace-cloud/host`** — `LaceTransport` (gRPC-JS client; bearer auth; proto→render converters), `ServerManager` (spawns/watches `lace engine`), engine handshake parser, `RpcError` + `classifyRpcError`. **Vscode-free** — Node-only library.
- **`@lace-cloud/canvas`** — `<App>` (root), `Canvas.tsx` (ReactFlow viewport), `CanvasEngine` interface, `PostMessageEngine` (VS Code postMessage), `ConnectWebEngine` (browser fetch), hooks (`useToast`, `useGroupLogic`, etc.), components, `events.ts` (centralized `CANVAS_EVENTS`).
- **`@lace-cloud/chat-core`** — `ChatHostAdapter` interface, `AgentController` (agentic loop), `ToolRegistry`, `ProactivityWatcher`, history codec. **Vscode-free.**
- **`@lace-cloud/chat-webview`** — pure React chat UI (`<App>`, message components, postMessage bridge contract).
- **`@lace-cloud/proto`** — generated proto messages, render-model POJOs, proto→render converters.
- **`@lace-cloud/ui`** — design-system primitives.
- **`@lace-cloud/design-tokens`** — CSS tokens + JS exports.

## Protocol

Host ↔ webview messages live in `@lace-cloud/proto` (`HostToWebview`) and host's
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

Defined in `@lace-cloud/canvas` (lace). Both transport implementations conform.

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

### Render types (`@lace-cloud/proto` — single source)

```
CanvasView { module_name, nodes: RenderNode[], edges: RenderEdge[], errors: RenderError[], groups: RenderGroup[], can_undo, can_redo, is_dirty }
RenderNode { id, label, kind, module_key?, icon_url?, position, has_errors, error_messages, inputs: NodePin[], outputs: NodePin[] }
RenderEdge { id, source, target, source_output, target_input }
RenderGroup { id, label, node_ids: string[], collapsed }
NodePin { name, type, type_family?, required?, wired?, description?, sensitive? }
```

Query response types: `NodeConfig`, `EdgeConfig`, `SettingsConfig`, `RenderError`, `Diagnostic`, `GeneratePhase`.

### Proto message types and converters

Lives in lace's published `@lace-cloud/proto`, `@lace-cloud/host`, and
`@lace-cloud/canvas` packages — each ships its own `./generated/service` (ts-proto
emits service stubs differently per output: gRPC-JS for host, generic-definitions
+ JSON codecs for canvas). Converters live in `@lace-cloud/proto`. See
[lace's AGENTS.md](https://github.com/lace-cloud/lace) for the
proto-gen pipeline details.

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
11. **Window events use centralized constants.** All custom event names are in `@lace-cloud/canvas`'s `events.ts` (`CANVAS_EVENTS`).

## Testing

### Unit tests (vitest)

Chat sidebar (`packages/chat-sidebar/src/__tests__/`):

- `chat-tools.test.ts`, `registry-tools.test.ts` — tool contract tests

Library tests (canvas hooks, chat-core agent loop, proactivity rules,
mock-engine, etc.) live in [`lace-cloud/lace`](https://github.com/lace-cloud/lace).

### `@vscode/test-electron` host smoke tests

`packages/host-e2e/`:

- `smoke.test.ts` — extension activates, canvas panel opens
- `commands.test.ts` — `lace.startEngine`, `lace.stopEngine`, terraform command palette entries (uses a placeholder binary path; exercises command wiring, not CLI spawn)
- `cli-integration.test.ts` — spawns the public release CLI from `releases.lace.cloud` via `ServerManager`, drives `initialize` + `authStatus` RPCs through `LaceTransport`. This is the test that catches CLI ↔ extension protocol drift before anything ships to Marketplace.

CI installs the release binary via the `install-release-cli` composite
(fetches `lace-cli-linux-amd64` + its sha256 sidecar from the Cloudflare
CDN). The lace-internal `-tags=test` bundle is lace's concern (flow-tests
with seed fixtures) and is not consumed here — the extension's contract
is the same binary real users run.

### Storybook + Chromatic + Playwright flow-tests

All three live in lace's CI now. This repo doesn't run them.

## Common Gotchas

- **PostMessage is async and untyped at runtime.** `WebviewToHost` / `HostToWebview` are contracts; at runtime, messages are plain objects. Handle unknown fields defensively.
- **`generation` must increment on every `loadState`** or fitView won't trigger.
- **`is_dirty` comes from the CLI**, not tracked locally. Webview posts `markDirty`/`markClean`.
- **Keyboard shortcuts are HTML-level** (in `src/vscode/canvas-panel.ts`'s prebody script). They call globals (`__canvasUndo`, etc.) set by canvas hooks (defined in `@lace-cloud/canvas`).
- **`engineResult` routing.** Only PostMessageEngine's pending calls resolve through this bridge; ConnectWebEngine uses fetch directly.
- **`@lace-cloud/*` versioning is lockstep.** All seven packages publish at the same version (`v0.1.0`, `v0.1.1`, …). When you bump one, bump them all — `pnpm update '@lace-cloud/*' --latest` does this in one shot.
- **`NODE_AUTH_TOKEN` is required for `pnpm install`.** `@lace-cloud/*` packages are public on GH Packages but the registry requires a token (any classic PAT with `read:packages` works locally; CI uses `GITHUB_TOKEN`).

## Style Guide

- TypeScript strict mode. No `any` except at RPC boundaries. Zero `as any` in new code.
- Function components with hooks. No class components.
- Descriptive test names stating behavior, not implementation.
- No dead code. Every export is consumed. `npx tsc --noEmit` — zero errors.

## Dependencies

**Runtime (extension shell):** `@grpc/grpc-js`, `react`, `react-dom`, `@xyflow/react`,
plus the seven `@lace-cloud/*` packages from lace.

**Dev:** `typescript`, `vitest`, `@rspack/cli`, `ts-loader`, `css-loader`,
`style-loader`, `file-loader`, `postcss`, `postcss-loader`, `@biomejs/biome`,
`husky`, `lint-staged`, `vsce`, `@vscode/test-cli`, `@vscode/test-electron`,
`@types/{vscode,node,mocha}`.

**Zero native Node.js modules.** The CLI handles all heavy lifting (terraform exec,
IR manipulation, registry HTTP). The extension is pure JavaScript.
