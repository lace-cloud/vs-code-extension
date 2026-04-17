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
src/                                — extension shell (VS Code-coupled, not published)
  extension.ts                      — activation, command registration, view-provider wiring
  canvas-webview-entry.tsx          — rspack entry for webview.js (canvas)
  canvas-webview-entry.css          — global stylesheet for the webview bundle
  vscode/                           — vscode-coupled host primitives
    canvas-panel.ts                 — canvas WebviewPanel + Subscribe stream bridge
    module-detail-panel.ts          — module detail tab
    registry-sidebar.ts             — registry WebviewViewProvider
    webview-html.ts                 — shared HTML scaffold (CSP, nonce)
    rpc-error-ui.ts                 — vscode.window error toast for classified RPC errors

packages/                           — workspace packages (will move to lace-core monorepo)
  proto/          @lace/proto          — shared proto messages + render POJOs + converters
  host/           @lace/host           — vscode-free library: LaceTransport, ServerManager, engine handshake, RpcError + classifier
  canvas/         @lace/canvas         — webview UI (React, ReactFlow). PostMessageEngine + ConnectWebEngine
  chat-sidebar/   @lace/chat-sidebar   — VS Code chat adapter: ChatViewProvider, vscode-adapter, controller
  chat-core/      @lace/chat-core      — vscode-free agentic loop + tool registry + proactivity rules
  chat-webview/   @lace/chat-webview   — pure React chat UI
  design-tokens/  @lace/design-tokens  — CSS variables / tokens
  ui/             @lace/ui             — design-system primitives (Button, IconButton, …)
  canvas-stories/ @lace/canvas-stories — Storybook for canvas composites + @lace/ui primitives
  host-e2e/       @lace/host-e2e       — E2E scaffold (Phase G)
```

`@lace/host` is intentionally vscode-free: any consumer (chat-core,
canvas, future portal/JetBrains adapters) can import from it without
loading vscode at module-load time. The vscode-coupled primitives
that used to live there (panel classes, webview-html builder, RPC
error toast) moved to `src/vscode/` — they're not library code.

### Design system

- **Tokens first.** All colors go through `var(--lace-*)` from `@lace/design-tokens/tokens.css`. No raw hex in new code; no inline Tailwind arbitrary-value classes like `bg-[#1f6feb]`. If a color isn't in the tokens file, add a token there first.
- **Primitives in `@lace/ui`.** `Button`, `IconButton` today; more coming (Badge, Panel, Modal, ModeToggle, CollapseToggle, Input). Stories live colocated with the primitive (`packages/ui/src/Button/Button.stories.tsx`) and are picked up by Storybook via the `canvas-stories/.storybook/main.ts` glob.
- **Composites consume primitives.** Canvas components should import `Button` from `@lace/ui`, not reinvent button markup. Composite refactors happen incrementally — one composite per session/PR.

Rspack builds three bundles from the workspace:

- `out/extension.js` (Node) — entry `src/extension.ts` (extension activation; vscode-coupled host primitives in `src/vscode/`)
- `out/webview.js` (Browser) — entry `src/canvas-webview-entry.tsx` (VS Code-specific bootstrap; @lace/canvas itself is pure library code)
- `out/chat-sidebar.js` (Browser) — entry `packages/chat-sidebar/src/webview-entry.tsx`

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

## Branch Flow

The repo is ruleset-gated into a three-step promotion path:

- **Feature branches** branch off `develop`, PR to `develop`. `ci.yml` runs
  lint + unit-tests + host-e2e + `ci-summary`. `ci-summary` is the required
  status check; direct pushes to `develop` are blocked.
- **`develop`** is the long-lived integration branch. On every merge, a push
  to `develop` triggers `ci-visual.yml`: in parallel, (a) the `chromatic`
  job uploads every Storybook component story to Chromatic for visual
  regression, and (b) the `flow-tests` job runs Playwright integration /
  contract tests against the real `lace engine` (from the R2 test bundle)
  with DOM assertions — no visual upload. Approve visual changes in the
  Chromatic UI.
- **`main`** accepts PRs only from `develop`. Two required status checks on
  the ruleset: `CI Visual / visual-summary` (only exists on commits built
  via `ci-visual.yml`, which only runs on `develop` — implicit source check)
  and `Release / version-bumped` (fails if `package.json` version hasn't
  moved vs `main`). Direct pushes blocked.
- **Push to `main`** triggers `release.yml`'s release path: build, package,
  tag, `vsce publish`, GitHub Release with `.vsix` attached.

### Shipping a New Version

1. On your feature branch, run `pnpm version patch` (or `minor` / `major`).
   Commit the `package.json` change.
2. PR → `develop`. `ci.yml` runs. Merge.
3. After the merge-triggered `ci-visual.yml` run finishes, approve any
   visual changes in the Chromatic UI.
4. Open `develop` → `main` PR. `version-bumped` passes (step 1 bumped it);
   `visual-summary` is already green (step 3). Merge.
5. `release.yml` auto-ships: tag, Marketplace publish, GitHub Release.

### Visual regression (Chromatic)

Chromatic handles visual regression via Storybook mode only. The
`chromatic` job in `ci-visual.yml` builds the canvas-stories Storybook
and uploads every component story as a snapshot. New story = new
coverage for free. CI uses `--exit-zero-on-changes` so runs stay green
regardless of visual deltas — approval is gated in the Chromatic UI,
not in CI.

Flow visuals split into two twin sets:

- **`Flows/*`** — live-CLI stories driven by `FlowDecorator` +
  `ConnectWebEngine`. Tagged `chromatic: { disableSnapshot: true }`
  (Chromatic's cloud can't spawn `lace engine`). These exist for
  Playwright flow-tests that hit the real CLI to check the wire
  contract.
- **`Flows/Mock/*`** — mock-engine stories driven by `MockFlowDecorator` +
  `MockCanvasEngine`, backed by captured fixtures in
  `packages/canvas-stories/src/mocks/fixtures/`. These are **not**
  tagged `disableSnapshot` — Chromatic captures them. No CLI, no
  network, no env vars.

#### Regenerating mock fixtures

Fixtures are captured once from a live `lace engine -tags=test` and
committed as TS files. Regenerate when lace-cli changes a seed (the
seed-drift canary in `tests/flow/seed-manifest.spec.ts` flags this):

```
pnpm run capture-fixtures     # spawns `lace engine`, overwrites TS files
```

The capture script converts the Connect-JSON proto response to
render-model POJOs using the same enum and camelCase-to-snake_case
mapping as the runtime `convertCanvasView` converter, so fixtures are
byte-equivalent to what `ConnectWebEngine` would produce at runtime.

#### Review protocol

Chromatic's diff view only shows *changed* pixels. That's not enough
to catch a story that renders broken in isolation — a newly-broken
story gets accepted as a clean baseline. So every PR review walks
through the Storybook Library view, not just the diff.

- **PR description lists new/changed stories.** One bullet per story
  so the reviewer knows what to click. If a PR only touches plumbing
  (no story changes), say that.
- **Reviewer opens each in the Chromatic Library**, not just the
  "Changes" tab. Confirm the component looks the way it should look
  in the real app — not just that nothing is different from last
  time.
- **Broken-isolation stories → deny in Chromatic + fix forward.**
  Never accept a snapshot of a misrendered story as the baseline.
  Diagnose why it renders broken (missing CSS, missing positioning
  context, missing provider, missing decorator) and fix it in the
  same PR.
- **Stories tagged `chromatic: { disableSnapshot: true }` are
  ignored.** Live-CLI `Flows/*` stories fall here — they show the
  `CliMissingBanner` fallback because Chromatic's cloud can't spawn
  the CLI. That's expected; the mock twins (`Flows/Mock/*`) are the
  ones Chromatic captures.
- **Rule of thumb:** if a story in the library doesn't match how the
  component actually looks in the app, the story or the component is
  wrong — never the baseline.

#### Scene stories

A **scene story** composes multiple components in their intended
spatial arrangement — e.g. a canvas with two wired ModuleNodes + a
ContextMenu open on the second one, all at real layout scale. Scene
stories catch layout regressions that single-component stories miss
(header overlapping pin rows, context menu escaping the canvas
frame, panel pushing the canvas below the fold) and serve as
designer-facing reference renders.

Scenes mount the real `App` against `MockFlowDecorator` + a
`MockCanvasEngine`. They can:

- Pin transient UI state (Toast, banner) via `EngineEvent.toastDurationMs = Infinity`.
- Skip transient UI to capture a follow-on state (`toastDurationMs = 0`).
- Inject per-instance `NodeConfig` / `SettingsConfig` / `EdgeConfig` via `MockFlowDecorator`'s `engineOptions` prop.
- Dispatch window events (`openNodeConfig`, `canvasContextMenu`, `canvasViewUpdated`) from `onReady` to drive panel/menu state.
- Synthesize a click on an ActionBar button by `aria-label` when no external event exists.

#### Coverage invariants (canonical per composite)

Future PRs should not drop below these. Adding stories is fine;
deleting or renaming the canonical ones requires a note in the PR.

**Primitives (`UI / *`)** — one story per variant + one matrix story per size-or-state axis. Current: Button (9), IconButton (7), Badge (6), Panel (4), Modal (4), Input (8), Textarea (4), ModeToggle (4), CollapseToggle (3).

**Composites (`Components / *`)** — at least the happy path + one "extreme" state (error, max data, or long text) that catches layout drift:

- `ActionBar` — default, generating, minimap-shown, interactive-toggle, read-only
- `Toast` — success, error, progress (phase variants are visually identical; one story covers them all)
- `ContextMenu` — single-node, multi-select, group-right-click
- `ValidationErrorBanner` — single diagnostic, multiple diagnostics (dialog state covered via Scene)
- `AccordionSection` — closed, open
- `ModuleNode` — simple-module, with-error, newly-added, many-pins, resource
- `GroupNode` — expanded, collapsed, collapsed-with-errors
- `SlidePanel` — open, closed

**Config panels (`Panels / *`)** — empty + populated, minimum:

- `TerraformConfigPanel`, `LocalsPanel`, `ProvidersPanel`, `EnvironmentsPanel` — empty + populated each
- `EdgeInspectorPanel` — typical (no empty state; only opens with a selected edge)
- `ModuleConfigPanel` — loading, populated-with-required, wired-inputs, read-only
- `UnifiedSettingsPanel` — loading, populated, empty

**Flows**:

- `Flows / *` — one per seed fixture (empty, iam-role, wired-stack, iam-stack, collapsed-group). `disableSnapshot: true`; Playwright exercises them against the real CLI.
- `Flows / Mock / *` — mock twins of the live flows, Chromatic-captured.
- `Flows / Scene / *` — canonical user moments: SaveSuccess, Generating, ValidationError, MiniMapVisible, MiniMapHidden, ConfigOpen, SettingsOpen, EdgeSelected, ContextMenuOpen, ConfirmClear, ReadOnly.

New primitives, composites, or panels need their canonical entries appended to this list in the same PR that ships them.

### Playwright flow-tests (integration / contract)

`tests/flow/canvas-golden-paths.spec.ts` runs the flow stories against
a real `lace engine` in the pinned CI container, asserting shape-level
DOM invariants (node counts, data attributes, pin counts). These are
**integration tests, not visual tests** — no Chromatic upload.

What they catch:
- CLI↔extension wire-format regressions (proto fields, Action oneof
  shapes, Subscribe event types)
- Engine handshake / auth / Subscribe stream bugs
- ReactFlow / xyflow upgrades that break real-DOM rendering
- Fixture-to-render drift (amplified by the seed-drift canary)

Notes:
- Flow stories use `testSessionOpen(fixtureName)` for determinism —
  stories load embedded seed fixtures from the CLI's `-tags=test`
  build. Requires a CLI built via `make build-test` in lace-cli.
- The seed-drift canary (`tests/flow/seed-manifest.spec.ts`) runs
  first. If lace-cli regenerates seeds, the canary fails with a clear
  "hash mismatch" message before any flow test runs — update
  `tests/flow/__snapshots__/seed-manifest.json` in the same PR.
- Locally, set `LACE_CLI_REPO=../lace-cli` (or absolute path) so the
  canary can find lace-cli's `testdata/seeds/*.sha256` canaries.

### Read-only mode

The `@lace/canvas` `App` takes an optional `readOnly?: boolean` prop
(default `false`) so consumers that show state without letting users
mutate it — portal's control plane is the driving example — can mount
the same canvas without re-implementing half of it.

**Semantic contract: view manipulation vs. IR mutation.**

- Allowed: pan, zoom, selection, hover/tooltip inspection, MiniMap
  toggle + zoom controls, panel inspection (ModuleConfigPanel,
  UnifiedSettingsPanel, EdgeInspectorPanel in inspection-only shapes),
  drag-to-reposition (xyflow local state updates; no `syncLayout`
  round-trip), expand/collapse groups (local override merged into the
  view before it reaches `useGroupLogic`).
- Blocked: delete, rename, connect, reconnect, create group, ungroup,
  edit any input in any panel, Save (Cmd+S), Generate, Undo/Redo,
  Clear all, copy/cut/paste, context menu.

**Three-layer gating principle** — gate at the layer closest to the
concern. No belt-and-suspenders.

1. **xyflow native props** for every capability xyflow owns:
   `nodesConnectable={!readOnly}`, `edgesReconnectable={!readOnly}`,
   `deleteKeyCode={readOnly ? null : [...]}`. Don't re-implement at the
   handler layer.
2. **Conditional handler installation** for window-level listeners.
   `CANVAS_EVENTS.SAVE` and `CANVAS_EVENTS.GENERATE` handlers, plus
   `window.__canvasUndo` / `__canvasCopy` / `__canvasCut` /
   `__canvasPaste`, are skipped when `readOnly`. The host may still
   dispatch Cmd+S/Z/C/X/V — it falls through to a no-op because nothing
   is installed. No runtime guard needed.
3. **Render gates** for UI affordances. ActionBar renders only the
   MiniMap toggle + Settings gear; ModuleNode / GroupNode hover-delete
   + ungroup buttons render `null`; panel Save / Disconnect / Add /
   Remove buttons render `null`; Input / Textarea forwards `readOnly`;
   ModeToggle items all `disabled`.

**No engine-layer guard.** The hosted backend (portal) rejects via
authz; canvas's job is not to attempt. UI gate + conditional handler
install = two independent defenses at the right layers.

**Group collapse in read-only** is the one structural nuance. It's a
view op that normally persists via `engine.updateGroup({collapsed})`,
which we must not call in read-only. `CanvasContext` carries a
`localGroupCollapseOverrides` map; `App` merges it into `view.groups`
before rendering so `useGroupLogic` (xyflow's child-hiding + external
pin computation) reads the effective collapsed flag from one source of
truth.

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
| `src/extension.ts`              | Activation, command registration, view provider wiring                                  | Node              |
| `host/transport.ts`             | `LaceTransport` — gRPC-JS client; bearer auth; proto→render converters                  | Node              |
| `host/server-manager`           | Spawns/watches `lace engine`, routes the handshake into a transport                     | Node              |
| `src/vscode/canvas-panel.ts`    | Canvas webview panel + Subscribe stream bridge                                          | Node (mounts DOM) |
| `src/vscode/webview-html.ts`    | Shared HTML scaffold (CSP, nonce) used by canvas + chat sidebar                         | Node              |
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
