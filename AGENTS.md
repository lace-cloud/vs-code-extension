# AGENTS.md — Lace VS Code Extension

This document is for AI coding agents (Claude, Copilot, Cursor, etc.) working on the Lace codebase. It contains the invariants, conventions, and constraints you must follow. Violating these will produce code that fails tests or breaks the wire protocol with the Go CLI.

## What This Project Is

A VS Code extension for visually composing Terraform modules. Users browse modules from a registry sidebar, add them to a ReactFlow canvas, wire inputs/outputs, configure settings, and generate `.tf` files. Users can also compose infrastructure via natural language using the `@lace` chat participant in VS Code Chat. The extension talks to a Go CLI binary (`lace`) over JSON-RPC stdin/stdout. All state persists in a `.lace/` directory at the workspace root.

## Build & Test Commands

```bash
npm test                    # Run all tests: unit + E2E (Vitest)
npm run test:unit           # Unit tests only (225+ tests, no binary needed)
npm run test:e2e            # E2E tests only (6 tests, requires lace + terraform)
npm run test:watch          # Watch mode (unit tests)
npm run build               # Rspack build (both host + webview)
npx tsc --noEmit            # Type-check only (must be zero errors)
```

Always run `npm run test:unit` after any change. All 225+ unit tests must pass. TypeScript must compile with zero errors.

E2E tests require the `lace` binary and `terraform` to be installed. They spawn a real `lace module serve` process and talk JSON-RPC. If the binary is missing, the tests fail with install instructions. Set `LACE_BINARY=/path/to/lace` to override the default PATH lookup.

## Critical Invariants — Do Not Break These

### 1. `toBundle` and `fromBundle` are the serialization boundary

`src/webview/utils/bundle.ts` — These two functions are the boundary between workspace state and wire format. Changes require careful consideration of wire protocol compatibility with the Go CLI.

- `toBundle(workspace)`: Strips `layouts`, injects derived `wires` into graphs.
- `fromBundle(bundle, hints?)`: Normalizes bindings, computes layouts, strips wires. Collects errors without throwing.

### 2. Wire format matches Go JSON tags exactly

Field names in `src/webview/types/ir.ts` are `snake_case` and match Go's JSON struct tags: `module_id`, `required_version`, `depends_on`, `interface`, `schema_version`. **Never rename to camelCase. Never add an aliasing layer.**

The word `interface` is a legal TypeScript property name (only reserved in declaration context). When destructuring, use: `const { interface: iface } = def;`

### 3. Wires are derived, never stored

Wires exist only in the bundle (for the CLI). They are derived from `out` bindings by `deriveWires()` in `toBundle()` and stripped by `fromBundle()`. The workspace state never contains wires. If you're storing wires, you're wrong.

### 4. Pure reducer, no side effects

`src/webview/state/reducer.ts` — Every state transition is `(WorkspaceState, WorkspaceAction) → WorkspaceState`. No mutations, no side effects, no Proxy libraries. All updates use explicit object/array spreads. This is what makes the logic testable without React.

### 5. Validate at the boundary, trust downstream

`fromBundle` normalizes all incoming data into canonical discriminated unions via `normalizeBinding()` and `normalizeInstance()`. Once past the boundary, use type guards (`isOut`, `isVar`, `isModuleInstance`, etc.) — never `as` casts or `!` assertions.

### 6. `.lace/` is the persistence model

All state lives in `.lace/lace.json` at the workspace root. Generated `.tf` files go into the same `.lace/` directory. There is no global storage, no Store class, no component naming. One workspace = one component.

### 7. Registry browsing is host-side

The webview never fetches registry data. The extension host owns all registry data (via `RegistrySidebarProvider`), fetches `deploy_bundle` via RPC, and posts `dropBundle` messages to the canvas. Module adds are always host-initiated.

### 8. Node data is serializable

`ModuleNodeData` contains no callbacks. Communication from nodes to canvas goes through `CanvasContext` (React context with `openConfig`, `markDirty`). For dispatch and module key, nodes read from `(window as any).__canvasDispatch` and `(window as any).__activeModuleKey` — this is intentional (ReactFlow node rendering doesn't support prop drilling).

## Type System

### Key types in `src/webview/types/ir.ts`

```typescript
type Binding =
  | { lit: any }
  | { var: string }
  | { out: { module: string; name: string } }
  | { expr: { lang: 'hcl'; value: string } };
type Instance = ModuleInstance | ResourceInstance | DataInstance; // discriminated on `kind`
type ModuleDef = {
  schema_version;
  kind;
  id;
  version;
  description?;
  source?; // present for leaf modules (registry/git/local)
  interface;
  graph; // always present — every module has a graph
  terraform?;
  providers?;
};
type ModuleBundle = {
  schema_version;
  kind;
  entry: ModuleRef;
  modules: Record<string, ModuleDef>;
  environments?;
  environment_backends?;
};
```

### Workspace state in `src/webview/types/workspace.ts`

```typescript
type WorkspaceState = ModuleBundle & { layouts: Record<string, GraphLayout> };
```

This is a structural identity: workspace IS a bundle plus layouts. `toBundle` strips layouts. `fromBundle` adds them.

### Module keys

Modules are keyed as `"${id}@${version}"` in the flat `modules` record. Example: `"iam-stack@v1.0.0"`. The `entry` field references the root composite by `{ module_id, version }`.

### Protocol types in `src/types/protocol.ts`

Single source of truth for all shared types:

- `HostToWebview` / `WebviewToHost` — message unions between host and webview
- `RegistryModule` — shared across sidebar, detail panel, extension
- `Diagnostic` — RPC validation diagnostics
- `GraphError` — imported from `validate.ts`

## Reducer Actions (Complete List)

The full union is in `reducer.ts`. Every action carries `module_key` (except workspace-level ones like `SET_ENVIRONMENTS`).

**Core editing:**
`DROP_BUNDLE`, `CONNECT`, `DISCONNECT`, `UPDATE_INPUTS`, `RENAME_INSTANCE`, `DELETE_INSTANCE`, `SYNC_LAYOUT`, `LOAD_WORKSPACE`

**Composite interface:**
`SET_VARIABLES`, `SET_EXPORTS`

**Terraform config:**
`SET_TERRAFORM`, `SET_PROVIDERS`, `SET_LOCALS`, `SET_DEPENDS_ON`, `SET_ENVIRONMENTS`, `SET_ENVIRONMENT_BACKENDS`

### Adding a new reducer action

1. Add the action type to the `WorkspaceAction` union in `reducer.ts`.
2. Create a `handleXxx` function following the existing pattern (extract fields, return new state with spreads).
3. Add the case to the switch in `workspaceReducer`.
4. Add tests in `__tests__/` — use the existing `makeWorkspace()` helper from `reducer.test.ts` or `terraform-config.test.ts`.
5. Run `npm test` — all tests must pass.

### The `updateCompositeGraph` helper

Most actions that modify a composite's graph use this helper:

```typescript
function updateCompositeGraph(
  state: WorkspaceState,
  module_key: string,
  fn: (graph: CompositeGraph) => CompositeGraph,
): WorkspaceState;
```

It handles the nested spread `state → modules → module → graph` and is a no-op if the module doesn't exist.

## File Organization Conventions

| Layer             | Directory                                       | What goes here                                            |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------- |
| IR types          | `webview/types/ir.ts`                           | Wire format types only. Must match Go.                    |
| Workspace types   | `webview/types/workspace.ts`                    | `WorkspaceState`, `GraphLayout`                           |
| Protocol types    | `types/protocol.ts`                             | Message unions, shared types (RegistryModule, Diagnostic) |
| Pure logic        | `webview/utils/`                                | bundle, derive, validate, resolve, identifiers, record    |
| State management  | `webview/state/`                                | reducer (pure), context (React context)                   |
| UI components     | `webview/components/`                           | nodes, panels                                             |
| Chat participant  | `chat/`                                         | `@lace` chat participant, tool registry, LM tools         |
| Chat tools        | `chat/tools/`                                   | registry, graph-read, graph-write, workspace, generate    |
| Tests             | `webview/__tests__/`                            | Unit test files + fixtures                                |
| E2E tests         | `webview/__tests__/e2e-rpc-integration.test.ts` | Spawns real CLI, full RPC pipeline                        |
| CI/CD             | `.github/workflows/ci.yml`                      | GitHub Actions: unit + E2E with lace + terraform          |
| Host-side         | `webview/createWebviewPanel.ts`                 | .lace/ persistence, validation flow, generate             |
| Host-side         | `webview/ModuleDetailPanel.ts`                  | Extensions-style detail tab for registry modules          |
| Registry          | `containers-views/RegistrySidebarProvider.ts`   | WebviewViewProvider with inline search                    |
| CLI communication | `utilities/engine/`                             | ServerManager, JSONRPCClient                              |

## Host ↔ Webview Protocol

Messages are discriminated unions in `src/types/protocol.ts`.

**Host → Webview:** `loadState`, `triggerSave`, `triggerGenerate`, `generateSuccess`, `generateError`, `dropBundle`, `validationErrors`

**Webview → Host:** `webviewReady`, `saveState`, `generateBundle`, `markDirty`

All registry browsing is host-side (not in the protocol). Module drops arrive as `dropBundle` messages from the host.

## Pre-Generate Validation Flow

In `createWebviewPanel.ts`, the `generateBundle` handler runs three steps:

1. **Graph validation** — Reconstruct workspace via `fromBundle`, run `validateWorkspace()`. If errors: send `validationErrors` + `generateError`, abort.
2. **Terraform validation** — RPC `validate({ bundle })`. Filter for `severity === 'error'`. If errors: send `generateError` with diagnostics, abort. If RPC unavailable (older CLI): log warning, proceed.
3. **Generate** — Clear validation errors, RPC `generate({ bundle, outputDir: .lace/ })`.

## Testing Conventions

Tests use Vitest. Fixtures are in `__tests__/fixtures/` — these are real CLI bundle snapshots.

### Unit vs E2E

Unit tests (`__tests__/*.test.ts` excluding `e2e-*`) are pure logic — no external processes, no filesystem, no network. They test the reducer, bundle transformations, validation, and utility functions.

E2E tests (`__tests__/e2e-rpc-integration.test.ts`) spawn the real `lace module serve` binary, exercise the full JSON-RPC transport, generate files to a temp directory, and run `terraform fmt -check` to validate HCL syntax. They require the `lace` binary and `terraform` to be installed.

### Test file naming

| File                          | Content                                             |
| ----------------------------- | --------------------------------------------------- |
| `e2e-rpc-integration.test.ts` | E2E: spawn CLI, full RPC pipeline, generate to disk |
| `reducer.test.ts`             | Core editing and composite interface actions        |
| `terraform-config.test.ts`    | Terraform config actions + full integration flow    |
| `bundle.test.ts`              | `toBundle`/`fromBundle` boundary                    |
| `validate.test.ts`            | `validateWorkspace` checks                          |
| `scaffold.test.ts`            | `emptyWorkspace` factory + round-trip fidelity      |
| `chat-tools.test.ts`          | Chat participant graph-write and graph-read tools   |
| `registry-tools.test.ts`      | Chat participant registry search and inspect tools  |
| `graph-summary.test.ts`       | `summarizeGraph` for chat descriptions              |
| `auto-connect.test.ts`        | Auto-connect name/type matching logic               |
| `normalize.test.ts`           | Binding and instance normalization                  |
| `resolve.test.ts`             | Module reference resolution                         |
| `parseValue.test.ts`          | HCL literal parsing                                 |
| `identifiers.test.ts`         | Terraform identifier validation                     |
| `derive.test.ts`              | Wire derivation from bindings                       |
| `infer.test.ts`               | Type inference utilities                            |

### Adding E2E tests

E2E tests follow this pattern:

1. `spawnServer(binary)` — get a `ChildProcess` + `JSONRPCClient`
2. `client.initialize('0.1.0')` — handshake
3. Build workspace using `emptyWorkspace` + reducer actions
4. `toBundle(ws)` → `client.validate({ bundle })` → `client.call('generate', ...)`
5. Assert on RPC results and/or files written to disk
6. `client.shutdown()` — clean exit
7. `afterEach` kills the process and disposes the client

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to `main`/`develop`. It installs Node.js, npm dependencies, the Lace CLI binary (from `releases.lace.cloud`), and Terraform (via `hashicorp/setup-terraform@v3`), then runs unit and E2E tests in sequence.

## Chat Participant (`@lace`)

The `@lace` chat participant lets users compose infrastructure via natural language in VS Code Chat. It uses the VS Code Chat Participant API and Language Model Tools API.

### Architecture

- **`chat/participant.ts`** — Registration + agentic tool loop. Runs up to 15 tool rounds per request.
- **`chat/tool-registry.ts`** — Simple `Map<string, ToolHandler>`. Each tool returns `{ content: string, isError?: boolean }`.
- **`chat/tools/`** — Five tool groups: `registry-tools` (search, inspect), `graph-read-tools` (describe, validate), `graph-write-tools` (add, remove, connect, disconnect, set-input, rename, auto-connect), `workspace-tools` (read project files), `generate-tools` (fire-and-forget generate).
- **`chat/system-prompt.ts`** — System prompt injected into every chat request.
- **`chat/graph-summary.ts`** — Summarizes workspace state into natural-language descriptions for the LM.
- **`chat/auto-connect.ts`** — Name/type matching logic for best-effort wiring between instances.
- **`chat/telemetry.ts`** — Session-level telemetry (start, tool invocations, feedback).

### Key constraints

- Chat tools run in the **extension host** (Node.js). They dispatch reducer actions to the webview via `dispatchToCanvas`.
- Tools that modify the graph (`graph-write-tools`) read the current state via `requestGraphState()`, apply reducer actions, and push the updated state back.
- Tool schemas are declared in `package.json` under `contributes.languageModelTools`. The tool names must match exactly between `package.json` and the handler registration.

## Common Gotchas

1. **`interface` is a valid property name.** Don't try to rename `ModuleDef.interface` to `iface` or `schema`. It matches the Go wire format. Destructure as `const { interface: iface } = def;` when needed.

2. **Instance `kind` normalization.** Go omits `kind` for module instances (`omitempty`). `fromBundle` normalizes empty/missing `kind` to `'module'`. The Go generator handles this.

3. **`depends_on` entries use `module.` prefix.** The wire format is `["module.iam_role", "module.iam_policy"]`. Helper functions in `reducer.ts` handle prefix-aware comparisons: `depMatchesInstance`, `depRenameInstance`, `depBareId`.

4. **Layout consistency.** Every operation that adds/removes/renames instances must also update the corresponding `GraphLayout` in `state.layouts[module_key]`. Forgetting this causes nodes to appear at (0,0).

5. **Cascading references on rename/delete.** `RENAME_INSTANCE` and `DELETE_INSTANCE` must cascade to: sibling `out` bindings, export outputs, `depends_on` arrays, and layout node keys.

6. **ReactFlow v12.** This project uses `@xyflow/react` v12. Node components receive `NodeProps<Node<TData, TType>>`. Check existing `ModuleNode.tsx` for the pattern.

7. **Two Rspack entries.** The build produces `out/extension.js` (Node.js, CommonJS) and `out/webview.js` (browser). They share types but run in different environments. Don't import VS Code APIs in webview code or DOM APIs in extension code.

8. **No dead code.** Every source file is imported by at least one other file. Every export is consumed. Every type in `protocol.ts` is used. Run `npx tsc --noEmit` — zero errors, zero warnings.

## Style Guide

- TypeScript strict mode. No `any` except at boundaries (`fromBundle`, RPC responses).
- Explicit spreads for all state updates. No `Object.assign`, no mutation.
- Type guards (`isOut`, `isModuleInstance`) for narrowing, not `as` casts.
- Tailwind CSS for all styling. No separate CSS files for components.
- Function components with hooks. No class components.
- Descriptive test names that state the behavior, not the implementation.

## Dependencies

**Runtime:** `react`, `react-dom`, `@xyflow/react` — that's it. Zero Node.js native modules.

**Dev:** `typescript`, `vitest`, `rspack`, `tailwindcss`, `postcss`, `prettier`, `husky`, `lint-staged`.

Do not add native dependencies (sqlite3, better-sqlite3, node-gyp, etc.). The extension relies on zero native Node.js modules — persistence uses `.lace/lace.json`, and the CLI handles all heavy lifting.
