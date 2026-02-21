# AGENTS.md — Lace VS Code Extension

This document is for AI coding agents (Claude, Copilot, Cursor, etc.) working on the Lace codebase. It contains the invariants, conventions, and constraints you must follow. Violating these will produce code that fails tests or breaks the wire protocol with the Go CLI.

## What This Project Is

A VS Code extension for visually composing Terraform modules. Users drag modules from a registry onto a ReactFlow canvas, wire inputs/outputs, configure settings, and generate `.tf` files. The extension talks to a Go CLI binary (`lace`) over JSON-RPC stdin/stdout.

## Build & Test Commands

```bash
npm test                    # Run all 87 tests (Vitest)
npm run test:watch          # Watch mode
npm run build               # Rspack build (both host + webview)
npx tsc --noEmit            # Type-check only (2 pre-existing warnings in non-webview files are expected)
```

Always run `npm test` after any change. All 90 tests must pass. The two TypeScript warnings in `RegistrySelectorProvider.ts` and `server-manager.ts` are pre-existing and not in scope.

## Critical Invariants — Do Not Break These

### 1. `toBundle` and `fromBundle` are frozen

`src/webview/utils/bundle.ts` — These two functions are the boundary between workspace state and wire format. **Do not change them.** If you think you need to, you're approaching the problem wrong.

- `toBundle(workspace)`: Strips `layouts`, injects derived `wires` into composite graphs.
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

### 6. Node data is serializable

`ModuleNodeData` and `CompositeNodeData` contain no callbacks. Communication from nodes to canvas goes through `CanvasContext` (React context with `openConfig`, `navigateIn`, `markDirty`). For dispatch and module key, nodes read from `(window as any).__canvasDispatch` and `(window as any).__activeModuleKey` — this is intentional (ReactFlow node rendering doesn't support prop drilling).

## Type System

### Key types in `src/webview/types/ir.ts`

```typescript
type Binding =
  | { lit: any }
  | { var: string }
  | { out: { module: string; name: string } }
  | { expr: { lang: 'hcl'; value: string } };
type Instance = ModuleInstance | ResourceInstance | DataInstance; // discriminated on `kind`
type ModuleImpl = LeafImpl | CompositeImpl; // discriminated on `kind`
type ModuleDef = {
  schema_version;
  kind;
  id;
  version;
  description?;
  interface;
  impl;
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

## Reducer Actions (Complete List)

The full union is in `reducer.ts`. Every action carries `module_key` (except workspace-level ones like `SET_ENVIRONMENTS`). Here's the quick reference:

**Core editing:**
`DROP_BUNDLE`, `CONNECT`, `DISCONNECT`, `UPDATE_INPUTS`, `RENAME_INSTANCE`, `DELETE_INSTANCE`, `SYNC_LAYOUT`, `LOAD_WORKSPACE`

**Composite interface:**
`SET_VARIABLES`, `SET_EXPORTS`

**Nested composites:**
`GROUP_INTO_COMPOSITE`

**Terraform config:**
`SET_TERRAFORM`, `SET_PROVIDERS`, `SET_LOCALS`, `SET_DEPENDS_ON`, `SET_ENVIRONMENTS`, `SET_ENVIRONMENT_BACKENDS`

### Adding a new reducer action

1. Add the action type to the `WorkspaceAction` union in `reducer.ts`.
2. Create a `handleXxx` function following the existing pattern (extract fields, return new state with spreads).
3. Add the case to the switch in `workspaceReducer`.
4. Add tests in `__tests__/` — use the existing `makeWorkspace()` helper from `reducer.test.ts` or `phase4.test.ts`.
5. Run `npm test` — all 90+ tests must pass.

### The `updateCompositeGraph` helper

Most actions that modify a composite's graph use this helper:

```typescript
function updateCompositeGraph(
  state: WorkspaceState,
  module_key: string,
  fn: (graph: CompositeGraph) => CompositeGraph,
): WorkspaceState;
```

It handles the nested spread `state → modules → module → impl → graph` and is a no-op if the module isn't composite.

## File Organization Conventions

| Layer             | Directory                       | What goes here                                         |
| ----------------- | ------------------------------- | ------------------------------------------------------ |
| IR types          | `webview/types/ir.ts`           | Wire format types only. Must match Go.                 |
| Workspace types   | `webview/types/workspace.ts`    | `WorkspaceState`, `GraphLayout`                        |
| Protocol types    | `types/protocol.ts`             | Host↔webview message unions                            |
| Pure logic        | `webview/utils/`                | bundle, derive, validate, resolve, identifiers, record |
| State management  | `webview/state/`                | reducer (pure), context (React context)                |
| UI components     | `webview/components/`           | nodes, panels, sidebars, breadcrumb                    |
| Tests             | `webview/__tests__/`            | Test files + fixtures                                  |
| Host-side         | `webview/createWebviewPanel.ts` | Message handling, validation flow, RPC calls           |
| CLI communication | `utilities/engine/`             | ServerManager, JSONRPCClient                           |

## Testing Conventions

Tests use Vitest. Fixtures are in `__tests__/fixtures/` — these are real CLI bundle snapshots.

### Writing tests

- Import `workspaceReducer` and action types from `../state/reducer`.
- Use `fromBundle()` to parse fixture JSON into workspace state.
- Test reducer actions by applying them and asserting on the resulting state.
- Use `toBundle()` to verify round-trip fidelity.
- Use `validateWorkspace()` to verify graph integrity after operations.

### Test file naming

- `reducer.test.ts` — Core editing, composite interface, and grouping actions
- `phase4.test.ts` — Terraform config actions + full integration flow
- `bundle.test.ts` — `toBundle`/`fromBundle` boundary
- `validate.test.ts` — `validateWorkspace` checks
- `grouping.test.ts` — `GROUP_INTO_COMPOSITE` edge cases
- Other files test individual utilities

### Fixture files

| File                              | Content                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `leaf_deploy_bundle.json`         | Leaf module (`aws-s3-bucket`) wrapped in a deploy bundle                           |
| `composite_deploy_bundle.json`    | Composite module (`s3-stack`) with internal wiring                                 |
| `full_bundle_with_terraform.json` | Full `iam-stack` with terraform block, providers, locals, environments, depends_on |
| `bundle_with_bad_module.json`     | Bundle with a malformed module (for boundary error testing)                        |

## Host ↔ Webview Protocol

Messages are discriminated unions in `src/types/protocol.ts`. The host (Node.js side) and webview (browser side) communicate via `panel.webview.postMessage` / `window.addEventListener('message')`.

**Host → Webview:** `loadState`, `registryList`, `setRegistrySystem`, `triggerSave`, `triggerGenerate`, `generateSuccess`, `generateError`, `dropBundle`, `rpcError`, `validationErrors`, `engineStatus`

**Webview → Host:** `webviewReady`, `requestRegistryModules`, `saveState`, `generateBundle`, `fetchModuleVersion`, `markDirty`

## Pre-Generate Validation Flow

In `createWebviewPanel.ts`, the `generateBundle` handler runs three steps:

1. **Graph validation** — Reconstruct workspace via `fromBundle`, run `validateWorkspace()`. If errors: send `validationErrors` + `generateError`, abort.
2. **Terraform validation** — RPC `validate({ bundle })`. Filter for `severity === 'error'`. If errors: send `generateError` with diagnostics, abort. If RPC unavailable (older CLI): log warning, proceed.
3. **Generate** — Clear validation errors, RPC `generate({ bundle, outputDir, options })`.

## Depends_on Format

`depends_on` arrays use the `module.` prefix: `["module.iam_role", "module.iam_policy"]`. The validator in `validate.ts` strips this prefix when checking against instance IDs. The `ModuleConfigPanel` stores values with the prefix.

## Canvas Architecture

`Canvas.tsx` is the main webview component. Key patterns:

- **Node types**: `moduleNode` (leaf instances) and `compositeNode` (composite instances). Registered with ReactFlow's `nodeTypes`.
- **Error highlighting**: Nodes receive `hasErrors` and `errorMessages` in their data. When `hasErrors` is true, nodes render with a red border, tooltip, and error badge.
- **Navigation**: Composites support drill-in via double-click. The breadcrumb tracks the navigation stack. `activeModuleKey` determines which composite's graph is displayed.
- **Panel state**: Each panel (config, variables, outputs, terraform, providers, locals, environments) has boolean open state managed in Canvas.
- **Toolbar**: HTML buttons in `getWebviewContent.ts` post messages to open panels (Variables, Outputs, Terraform, Providers, Locals, Environments).

## Common Gotchas

1. **`interface` is a valid property name.** Don't try to rename `ModuleDef.interface` to `iface` or `schema`. It matches the Go wire format. Destructure as `const { interface: iface } = def;` when needed.

2. **Instance `kind` normalization.** Go omits `kind` for module instances (`omitempty`). `fromBundle` normalizes empty/missing `kind` to `'module'`. The Go generator handles this: it checks `kind == "resource" || kind == "data"` and falls through to module handling otherwise.

3. **`depends_on` entries use `module.` prefix.** The wire format is `["module.iam_role", "module.iam_policy"]`. Three helper functions in `reducer.ts` handle prefix-aware comparisons: `depMatchesInstance(dep, id)` checks if a dep references an instance (handles both `"module.X"` and bare `"X"`), `depRenameInstance(dep, oldId, newId)` renames preserving the prefix, and `depBareId(dep)` strips the prefix for set lookups. Every cascade handler (rename, delete, grouping) must use these helpers instead of direct string comparison.

4. **Layout consistency.** Every operation that adds/removes/renames instances must also update the corresponding `GraphLayout` in `state.layouts[module_key]`. Forgetting this causes nodes to appear at (0,0).

5. **Cascading references on rename/delete.** `RENAME_INSTANCE` and `DELETE_INSTANCE` must cascade to: sibling `out` bindings, export outputs, `depends_on` arrays, and layout node keys. Study the existing handlers carefully.

6. **`GROUP_INTO_COMPOSITE`** is the most complex action. It creates a new module def, migrates instances, rewires cross-boundary bindings to use variables/exports, creates a layout, and adds a single composite instance in the parent. Always test with `grouping.test.ts`.

7. **ReactFlow v12.** This project uses `@xyflow/react` v12. Node components receive `NodeProps<Node<TData, TType>>` — the generic is the full `Node` type, not just data. Check the existing `ModuleNode.tsx` and `CompositeNode.tsx` for the pattern.

8. **Two Rspack entries.** The build produces `out/extension.js` (Node.js, CommonJS) and `out/webview.js` (browser). They share types but run in different environments. Don't import VS Code APIs in webview code or DOM APIs in extension code.

9. **Empty arrays vs undefined.** Some reducer actions clear fields to `undefined` when arrays are empty (e.g., `SET_LOCALS`, `SET_DEPENDS_ON`). Others keep the empty array (e.g., `SET_PROVIDERS`). Follow the existing pattern for each action.

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

Do not add native dependencies (sqlite3, better-sqlite3, node-gyp, etc.). The extension relies on zero native Node.js modules — persistence uses JSON files, and the CLI handles all heavy lifting.
