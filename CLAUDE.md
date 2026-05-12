# Lace VS Code Extension

VS Code extension for visually composing Terraform modules. Users browse
modules from a registry sidebar, add them to a ReactFlow canvas, wire
inputs/outputs, configure settings, and generate `.tf` files. The extension
talks to a Go CLI binary (`lace`) over gRPC on an ephemeral TCP port, with
a 5-line handshake (VERSION / PROTOCOL_VERSION / PORT / TOKEN / READY).

The chat sidebar is the primary composition interface — the system prompt
drives clarification-first workflows. The canvas is a visual inspection and
verification layer.

## Repo Layout (thin VS Code adapter shell)

```
src/                                — extension shell (VS Code-coupled, not published)
  extension.ts                      — activation, command registration, view-provider wiring
  canvas-webview-entry.tsx          — rspack entry for webview.js (canvas)
  canvas-webview-entry.css          — global stylesheet for the canvas webview bundle
  chat-webview-entry.tsx            — rspack entry for chat-sidebar.js (chat)
  vscode/                           — vscode-coupled host primitives
    canvas-panel.ts                 — canvas WebviewPanel + Subscribe stream bridge
    module-detail-panel.ts          — module detail tab
    registry-sidebar.ts             — registry WebviewViewProvider
    webview-html.ts                 — shared HTML scaffold (CSP, nonce)
    rpc-error-ui.ts                 — vscode.window error toast for classified RPC errors

packages/                           — only VS Code-specific workspace packages
  chat-sidebar/   @lace-cloud/chat-sidebar   — VS Code chat adapter: ChatViewProvider, vscode-adapter, controller
  host-e2e/       @lace-cloud/host-e2e       — VS Code integration tests (smoke + commands + release-CLI integration)
```

The library code (`@lace-cloud/canvas`, `@lace-cloud/host`, `@lace-cloud/chat-core`,
`@lace-cloud/chat-webview`, `@lace-cloud/ui`, `@lace-cloud/design-tokens`,
`@lace-cloud/proto`) lives in [`lace-cloud/lace`](https://github.com/lace-cloud/lace)
and ships to public npmjs.org via OIDC trusted publishing. Edits to those
packages happen in lace, get tagged `vX.Y.Z`, and consumers (this repo) bump
deps with `pnpm update`.

`@lace-cloud/host` is intentionally vscode-free: it's a Node.js library
(LaceTransport, ServerManager, RpcError + classifier) that any consumer can
import without loading vscode at module-load time. The vscode-coupled
primitives that used to share its package (panel classes, webview-html
builder, RPC error toast) live in `src/vscode/` — they're not library code,
they're the extension's activation surface.

### Design system

The design system lives in lace. This repo consumes it via published
packages — `@lace-cloud/design-tokens` for CSS tokens, `@lace-cloud/ui` for
primitives. New tokens and components are added in lace, not here.

Rspack builds three bundles:

- `out/extension.js` (Node) — entry `src/extension.ts` (extension activation; vscode-coupled host primitives in `src/vscode/`)
- `out/webview.js` (Browser) — entry `src/canvas-webview-entry.tsx` (VS Code-specific bootstrap; @lace-cloud/canvas itself is pure library code)
- `out/chat-sidebar.js` (Browser) — entry `src/chat-webview-entry.tsx` (VS Code-specific bootstrap; @lace-cloud/chat-webview is pure React)

## Build & Test

```
pnpm install              # @lace-cloud/* fetched from public npmjs.org, no auth

pnpm run build            # rspack build (all three bundles)
pnpm run test:unit        # vitest (chat-sidebar tests)
pnpm run test:host-e2e    # @vscode/test-electron smoke + command + release-CLI integration tests
pnpm run lint             # biome check
npx tsc --noEmit          # typecheck — must be zero errors
```

Library development (canvas, host, chat-core, etc.): see
[`lace-cloud/lace`](https://github.com/lace-cloud/lace). That repo
owns Storybook, Chromatic visual regression, Playwright flow-tests, and the
proto-gen pipeline.

## Branch Flow

The repo is ruleset-gated into a three-step promotion path:

- **Feature branches** branch off `develop`, PR to `develop`. `ci.yml` runs
  lint + unit-tests + host-e2e + `ci-summary`. `ci-summary` is the required
  status check; direct pushes to `develop` are blocked.
- **`develop`** is the long-lived integration branch. On every push that
  touches extension source, `pre-release.yml` publishes a Marketplace
  pre-release (see "Shipping" below). Visual regression for shared
  library code lives in lace's CI, not here.
- **`main`** accepts PRs only from `develop`. One required status check:
  `Release Guard / version-bumped` (fails if `package.json` version
  hasn't moved vs `main`). Emitted by `release-guard.yml` on every PR
  to main. Direct pushes blocked.
- **Push to `main`** triggers `release.yml`: build, package, tag,
  `vsce publish`, GitHub Release with `.vsix` attached.

### Shipping

Two channels, two cadences, [VS Code's pre-release convention][vs-pre]:
**stable uses even minors, pre-release uses odd minors**. Same
Marketplace version namespace, structurally non-overlapping lanes.

[vs-pre]: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

```
stable:      0.2.0, 0.2.1, 0.2.2, …    → pnpm version patch
             0.4.0, 0.4.1, …            → pnpm version 0.4.0 --no-git-tag-version (see below)
pre-release: 0.3.7, 0.3.8, 0.3.9, …    → automatic, stamped as run_number
             0.5.1, 0.5.2, …            → starts fresh when stable minor bumps
```

SemVer ordering does the routing. Pre-release users auto-upgrade to the
new stable on a minor bump (`0.4.0 > 0.3.anything`). Stable patch bumps
stay below the pre-release lane (`0.2.1 < 0.3.N`), so pre-release users
keep the newer build.

- **Pre-release (automatic)** — every push to develop that changes
  extension source fires `pre-release.yml`, which publishes
  `<major>.<stable_minor + 1>.<github.run_number>` to Marketplace's
  pre-release channel. Users who enable "Switch to Pre-Release Version"
  on Lace Cloud in VS Code pick it up automatically. No human action
  required. The version stamp is ephemeral — not committed back to the
  repo.
- **Stable (deliberate)** — the normal flow:
  1. On your feature branch, bump `package.json`:
     - Patch: `pnpm version patch` (0.2.5 → 0.2.6).
     - Minor: `pnpm version <MAJOR>.<MINOR+2>.0 --no-git-tag-version`
       (e.g. from `0.2.x`, run `pnpm version 0.4.0 --no-git-tag-version`).
       `pnpm version minor` would produce an odd minor, which is on the
       pre-release lane — `Release Guard / version-bumped` rejects it.
     Commit the `package.json` change.
  2. PR → `develop`. `ci.yml` runs. Merge. (The merge also fires
     `pre-release.yml`, publishing a pre-release on the odd-minor lane —
     that's fine, pre-release users get an early look.)
  3. Open `develop` → `main` PR. `version-bumped` passes (step 1 bumped
     it to an even minor). Merge.
  4. `release.yml` auto-ships: tag, Marketplace stable publish, GitHub
     Release with `.vsix` attached.

`github.run_number` is a workflow-local monotonic counter that gives
each pre-release a unique, strictly increasing patch; stays well within
Marketplace's 32-bit-per-component cap for decades.

### Bumping `@lace-cloud/*` library versions

When lace publishes a new version (e.g. `v0.2.0`):

```bash
pnpm update '@lace-cloud/*' --latest
```

Test locally, commit the lockfile bump, PR through develop → main as usual.

### Library-side concerns (live in lace)

Visual regression (Chromatic), Storybook coverage invariants, mock
fixture regeneration, Playwright flow-tests, scene stories, and the
canvas read-only contract all live in
[`lace-cloud/lace`](https://github.com/lace-cloud/lace).
This repo doesn't run Chromatic, doesn't run Playwright, and doesn't
own the canvas's `readOnly` semantics — those concerns moved out
when the libraries did.

When you change anything that *uses* the canvas/chat libraries (not
the libraries themselves), you're in the right repo. When you need
to change the libraries, work happens in lace and you bump
`@lace-cloud/*` versions here.

## Critical Rules

1. **Extension has NO IR types.** All IR (Bundle/Module/Binding) lives in the Go CLI. The extension only uses render-model types from `@lace-cloud/proto`.
2. **All canvas mutations go through the CLI via RPC.** `LaceTransport` (from `@lace-cloud/host`) is the gRPC-JS client; the canvas webview talks to the host over postMessage and the host relays to LaceTransport. The webview never modifies state directly.
3. **File I/O is CLI-owned.** Canvas persistence and protobuf encoding happen via `SessionOpen`/`SessionSave`/`SessionClose`.
4. **No domain knowledge in the extension.** No Terraform parsing, no HCL type inference, no cloud provider logic, no identifier validation. If you need domain logic, add an RPC to the CLI.
5. **`CanvasEngine` interface** lives in `@lace-cloud/canvas` (lace). It's the contract between webview and backend. Both `PostMessageEngine` (VS Code) and `ConnectWebEngine` (browser) implement it.
6. **Auth is CLI-owned.** The CLI handles `lace login`; the engine process emits a bearer token in its handshake; the extension attaches it to every RPC and never stores credentials.
7. **Chat is the primary interface.** The chat sidebar's system prompt drives composition through clarification-first workflows.

## Architecture

**This repo (extension shell):**

| Path                                | Purpose                                                              | Environment       |
| ----------------------------------- | -------------------------------------------------------------------- | ----------------- |
| `src/extension.ts`                  | Activation, command registration, view provider wiring               | Node              |
| `src/canvas-webview-entry.tsx`      | Canvas rspack entry; mounts `<App>` from `@lace-cloud/canvas`        | Browser           |
| `src/chat-webview-entry.tsx`        | Chat rspack entry; mounts `<App>` from `@lace-cloud/chat-webview`    | Browser           |
| `src/vscode/canvas-panel.ts`        | Canvas WebviewPanel + Subscribe stream bridge                        | Node (mounts DOM) |
| `src/vscode/webview-html.ts`        | Shared HTML scaffold (CSP, nonce) used by canvas + chat sidebar      | Node              |
| `src/vscode/registry-sidebar.ts`    | Registry WebviewViewProvider                                         | Node              |
| `src/vscode/module-detail-panel.ts` | Module detail tab                                                    | Node              |
| `src/vscode/rpc-error-ui.ts`        | `vscode.window` toast for classified RPC errors                      | Node              |
| `packages/chat-sidebar/host/`       | `ChatController`, `ChatViewProvider` (VS Code chat adapter)          | Node              |
| `packages/host-e2e/`                | `@vscode/test-electron` smoke + command + release-CLI integration    | Node              |

**Library code (in lace, consumed via `@lace-cloud/*`):**

| Package                  | Purpose                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `@lace-cloud/host`       | `LaceTransport` (gRPC-JS), `ServerManager`, `RpcError`, engine handshake      |
| `@lace-cloud/canvas`     | Canvas React UI (`<App>`, `Canvas.tsx`, hooks, PostMessage + ConnectWeb engines) |
| `@lace-cloud/chat-core`  | IDE-agnostic chat machinery (`AgentController`, `ToolRegistry`, proactivity)  |
| `@lace-cloud/chat-webview`| Pure React chat UI                                                           |
| `@lace-cloud/ui`         | Design-system primitives (Button, IconButton, Panel, Modal, etc.)             |
| `@lace-cloud/design-tokens`| CSS tokens + JS exports                                                     |
| `@lace-cloud/proto`      | Generated proto messages + render-model POJOs + converters                    |

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

**Proto changes:** the generated TypeScript proto outputs ship inside
`@lace-cloud/proto`, `@lace-cloud/host`, and `@lace-cloud/canvas` (each
package has its own `src/generated/`). To change the proto, edit
`proto/service.proto` in [`lace-cloud/lace`](https://github.com/lace-cloud/lace),
run `pnpm proto:gen` there, publish a new `@lace-cloud/*` version, then
bump deps here.

See `AGENTS.md` for the full set of invariants, type-system docs, and gotchas.
