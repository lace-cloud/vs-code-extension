# Lace VS Code Extension

VS Code extension for visually composing Terraform modules. Users browse
modules from a registry sidebar, add them to a ReactFlow canvas, wire
inputs/outputs, configure settings, and generate `.tf` files. The extension
talks to a Go CLI binary (`lace`) over gRPC on an ephemeral TCP port, with
a 5-line handshake (VERSION / PROTOCOL_VERSION / PORT / TOKEN / READY).

The chat sidebar is the primary composition interface — the system prompt
drives clarification-first workflows. The canvas is a visual inspection and
verification layer.

## Repo Layout (pnpm Workspace)

```
packages/
  proto/          @lace/proto          — shared proto messages + render POJOs (./render) + converters live per-package
  host/           @lace/host           — extension host: LaceTransport (gRPC-JS), canvas/registry/chat view providers, engine lifecycle
  canvas/         @lace/canvas         — webview UI (React, ReactFlow). PostMessageEngine (VS Code) + ConnectWebEngine (browser)
  chat-sidebar/   @lace/chat-sidebar   — chat webview + host controller (agentic tool loop, tools, proactivity)
  design-tokens/  @lace/design-tokens  — CSS variables / tokens
  canvas-stories/ @lace/canvas-stories — Storybook for canvas (component + flow stories)
  host-e2e/       @lace/host-e2e       — E2E scaffold (Phase G)
```

Rspack builds three bundles from the workspace:

- `out/extension.js` (Node) — entry `packages/host/src/extension.ts`
- `out/webview.js` (Browser) — entry `packages/canvas/src/index.tsx`
- `out/chat-sidebar.js` (Browser) — entry `packages/chat-sidebar/src/webview/index.tsx`

## Build & Test

```
pnpm install              # install workspace
pnpm run build            # rspack build (all three bundles)
pnpm run test:unit        # vitest (117 unit tests)
pnpm run proto:gen        # regenerate TS proto outputs (3 per-package variants)
npx tsc --noEmit          # typecheck — must be zero errors

# Storybook
pnpm run storybook              # component-only stories on :6006 (no CLI needed)
pnpm run dev:storybook-flows    # flow stories with live `lace engine -tags=test`
pnpm run storybook:build        # static storybook build

# Playwright flow tests
pnpm flow-tests                 # run golden-path tests against Storybook + CLI
```

### Visual regression (Chromatic)

Visual regression for both component stories and flow tests runs through
Chromatic. The project secret is `CHROMATIC_PROJECT_TOKEN` (repo-level).

Two modes feed the same Chromatic project:

- **Storybook mode** — the `chromatic` CI job builds the canvas-stories
  Storybook and uploads every component story as a snapshot. Adding a new
  story is automatic visual coverage; no test code required.
- **Playwright mode** — the `flow-tests` CI job runs `tests/flow/` as
  today. `takeSnapshot(page, 'name', testInfo)` from `@chromatic-com/playwright`
  captures artefacts, which `chromatic:playwright` uploads to the same
  project after the test run.

Each PR gets a Chromatic bot comment listing changed snapshots; reviewer
approves/rejects in the Chromatic UI. Approved snapshots become the new
baseline for the target branch. CI itself stays green regardless of visual
changes (`--exit-zero-on-changes`) — Chromatic holds the approval gate.

Flow stories carry `chromatic: { disableSnapshot: true }` in Storybook
mode because Chromatic's cloud can't spawn `lace engine`. Playwright mode
covers them.

### Playwright notes

- Flow stories use `testSessionOpen(fixtureName)` for determinism — stories load embedded seed fixtures from the CLI's `-tags=test` build. Requires a CLI built via `make build-test` in lace-cli.
- The seed-drift canary (`tests/flow/seed-manifest.spec.ts`) runs first. If lace-cli regenerates seeds, the canary fails with a clear "hash mismatch" message before any visual check — update `tests/flow/__snapshots__/seed-manifest.json` in the same PR.
- Locally, set `LACE_CLI_REPO=../lace-cli` (or absolute path) so the canary can find lace-cli's `testdata/seeds/*.sha256` canaries.

## Critical Rules

1. **Extension has NO IR types.** All IR (Bundle/Module/Binding) lives in the Go CLI. The extension only uses render-model types from `@lace/proto/render`.
2. **All canvas mutations go through the CLI via RPC.** `LaceTransport` (host) or `ConnectWebEngine` (browser) speak the same set of methods. The webview never modifies state directly.
3. **File I/O is CLI-owned.** Canvas persistence and protobuf encoding happen via `SessionOpen`/`SessionSave`/`SessionClose`.
4. **No domain knowledge in the extension.** No Terraform parsing, no HCL type inference, no cloud provider logic, no identifier validation. If you need domain logic, add an RPC to the CLI.
5. **Single `CanvasEngine` interface** (`packages/canvas/src/engine.ts`) is the contract between webview and backend. Both `PostMessageEngine` and `ConnectWebEngine` implement it — making the canvas transport-agnostic.
6. **Auth is CLI-owned.** The CLI handles `lace login`; the engine process emits a bearer token in its handshake; the extension attaches it to every RPC and never stores credentials.
7. **Chat is the primary interface.** The chat sidebar's system prompt drives composition through clarification-first workflows.

## Architecture

| Package / Layer                 | Purpose                                                                                 | Environment       |
| ------------------------------- | --------------------------------------------------------------------------------------- | ----------------- |
| `host/extension.ts`             | Activation, command registration, view provider wiring                                  | Node              |
| `host/transport.ts`             | `LaceTransport` — gRPC-JS client; bearer auth; proto→render converters                  | Node              |
| `host/server-manager`           | Spawns/watches `lace engine`, routes the handshake into a transport                     | Node              |
| `host/canvas-panel.ts`          | Canvas webview panel + Subscribe stream bridge                                          | Node (mounts DOM) |
| `host/webview-html.ts`          | Shared HTML scaffold (CSP, nonce) used by canvas + chat sidebar                         | Node              |
| `chat-sidebar/host/`            | `ChatController` (agentic loop, tool dispatch, proactivity), `ChatViewProvider`         | Node              |
| `chat-sidebar/webview`          | React chat UI                                                                           | Browser           |
| `canvas/App.tsx`                | Transport-agnostic canvas root; takes `engine: CanvasEngine` + `hostBridge: HostBridge` | Browser           |
| `canvas/Canvas.tsx`             | ReactFlow viewport + orchestrator; focused hooks for toasts, context menu, undo, etc.   | Browser           |
| `canvas/post-message-engine.ts` | `CanvasEngine` over VS Code postMessage (host relays to LaceTransport)                  | Browser           |
| `canvas/connect-web-engine.ts`  | `CanvasEngine` over Connect-JSON fetch; used by Storybook flow stories                  | Browser           |

### Canvas Hooks (extracted from Canvas.tsx)

`useToast`, `useContextMenu`, `useUndoRedo`, `useEdgeInspector`, `useGenerationStatus`,
`useNewNodeTracking`, `useClipboard`, `useGroupLogic`, `useSaveState`, `useWindowEvent`.

### Chat Tools (registered on extension activation)

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
| `lace_set_variable`                  | Canvas-level `var.NAME`                           |
| `lace_set_local`                     | Add/update local value (read-merge-write)         |
| `lace_set_environment`               | Per-environment variable overrides                |
| `lace_create_group` / `lace_ungroup` | Visual groups                                     |
| `lace_undo`                          | Undo last change                                  |
| `lace_generate`                      | Generate .tf files                                |

## How to Work on This Codebase

**Diagnose before you fix.** Before writing code, answer:

1. **What is the actual failure?** (Not the error message — the underlying state that's wrong.)
2. **Why does this pattern exist?** Read surrounding code and `AGENTS.md` before changing it.
3. **Where is the right layer to fix this?** A UI bug might be a missing RPC call. An RPC issue might be a CLI handler bug. Fix it at the source.

If a fix requires a special case, a flag, a workaround, or the words "for now" — stop and reconsider. The right fix is usually:

- A new RPC method or action, not a client-side patch
- A type change that makes the invalid state unrepresentable
- A shared utility, not duplicated logic
- Moving code to a different layer, not adding glue between layers

**Never make a test pass by weakening the assertion.** If a test fails, the code is wrong, not the test (unless the test is clearly stale and needs updating for a deliberate design change — say so explicitly).

**Proto changes:** Always use `pnpm run proto:gen`. Never hand-edit generated files or run `protoc` manually — the script uses `snakeToCamel=false` and emits three outputs (shared messages, gRPC-JS service stubs for host, generic definitions + JSON codecs for canvas).

See `AGENTS.md` for the full set of invariants, type-system docs, and gotchas.
