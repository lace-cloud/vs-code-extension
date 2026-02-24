---
name: lace-invariants
description: >
  Pure logic and state management invariants for Lace. Use when working on
  state/reducer.ts, utils/bundle.ts, utils/validate.ts, utils/derive.ts,
  utils/resolve.ts, utils/identifiers.ts, types/ir.ts, or types/workspace.ts.
  Also activate when adding reducer actions, modifying bindings, or touching
  anything related to the wire format, module definitions, or composite graphs.
---

## Frozen Functions — Do Not Modify

`toBundle()` and `fromBundle()` in `src/webview/utils/bundle.ts` are the
serialization boundary between TypeScript workspace state and the Go CLI
wire format. They are frozen. If you think you need to change them, you are
approaching the problem wrong. Build around them.

- `toBundle(workspace)`: Strips `layouts`, injects derived `wires` into
  composite graphs via `deriveWires()`.
- `fromBundle(bundle, hints?)`: Normalizes bindings, computes layouts,
  strips wires. Collects errors without throwing.

## Wire Format

Types in `src/webview/types/ir.ts` use `snake_case` field names that match
Go JSON struct tags exactly: `module_id`, `required_version`, `depends_on`,
`interface`, `schema_version`.

- NEVER rename fields to camelCase.
- NEVER add an aliasing or mapping layer.
- `interface` is a valid TypeScript property name. Destructure as:
  `const { interface: iface } = def;`

## Reducer Rules

`src/webview/state/reducer.ts` — Every transition is pure:
`(WorkspaceState, WorkspaceAction) → WorkspaceState`

- NO mutations. All updates use explicit `{ ...obj }` spreads.
- NO `Object.assign`. NO Proxy libraries. NO side effects.
- Use `updateCompositeGraph(state, module_key, fn)` for graph mutations —
  it handles the nested spread `state → modules → module → impl → graph`.

### Cascading Operations

`RENAME_INSTANCE` and `DELETE_INSTANCE` must cascade to ALL of these:

1. Sibling instance `out` bindings referencing the old/deleted ID
2. Export outputs in `graph.exports.outputs`
3. `depends_on` arrays (entries may use `"module.X"` prefix)
4. Layout node keys in `state.layouts[module_key]`

Missing any one of these causes silent data corruption.

### depends_on Format

Entries may be bare `"iam_role"` or prefixed `"module.iam_role"`.
Use the existing helpers: `depMatchesInstance()`, `depRenameInstance()`,
`depBareId()`. Do not write your own prefix logic.

### Layout Consistency

Every operation that adds, removes, or renames instances MUST also update
the corresponding `GraphLayout` in `state.layouts[module_key]`. Forgetting
this causes nodes to appear at (0,0) on the canvas.

## Adding a New Reducer Action

1. Add the action type to the `WorkspaceAction` union in `reducer.ts`
2. Create a `handleXxx` function following the existing spread pattern
3. Add the case to the switch in `workspaceReducer`
4. Add tests in `__tests__/` using `makeWorkspace()` helper
5. Run `npm run test:unit` — all 95+ tests must pass
6. Run `npx tsc --noEmit` — zero errors

## Type System

- Binding is a discriminated union: `{ lit }`, `{ var }`, `{ out }`, `{ expr }`
- Instance is discriminated on `kind`: `'module'`, `'resource'`, `'data'`
- ModuleImpl is discriminated on `kind`: `'leaf'`, `'composite'`
- Use type guards (`isOut`, `isVar`, `isLit`, `isExpr`, `isModuleInstance`)
  for narrowing. NEVER use `as` casts or `!` assertions downstream of
  `fromBundle`. `any` is only acceptable at boundaries.

## Wires

Wires are derived, never stored. They exist only inside bundles for the CLI.
Created by `deriveWires()` during `toBundle()`, stripped by `fromBundle()`.
The workspace state must never contain wires. If it does, something is wrong.
