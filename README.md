# Lace — Visual Terraform Module Composer

Lace is a VS Code extension that lets you visually compose Terraform infrastructure by dragging modules from a registry onto a canvas, wiring their inputs/outputs together, and generating production-ready `.tf` files. It communicates with a Go CLI backend (`lace`) over JSON-RPC for registry access, validation, and code generation.

![Lace canvas example](image.png)

## Quick Start

```bash
# Install dependencies
npm install

# Build (extension backend + webview frontend)
npm run build

# Run tests
npm test

# Launch in VS Code
# Press F5 → opens Extension Development Host
```

In the Extension Development Host, click the **Lace** icon in the activity bar. Create a component, drag modules from the registry sidebar onto the canvas, wire them together, configure inputs, and hit **Generate** to produce Terraform files.

### Prerequisites

- **Node.js** ≥ 18, **npm** ≥ 9
- **VS Code** ≥ 1.96.0
- **Lace CLI** binary (default path: `/usr/local/bin/lace`; configurable via `lace.binaryPath` setting)
- CLI authenticated via `lace login` (the extension never manages tokens)

## Architecture Overview

The extension has two runtime halves joined by VS Code's webview messaging bridge:

```
┌──────────────────────────────┐       ┌──────────────────────────────┐
│         Host (Node.js)       │       │      Webview (Browser)       │
│                              │       │                              │
│  extension.ts                │ msg   │  Canvas.tsx (ReactFlow)      │
│  createWebviewPanel.ts  ◄────┼──────►│  reducer.ts (pure state)     │
│  persistence.ts (JSON)       │       │  bundle.ts (toBundle/from)   │
│  ServerManager + RPC Client  │       │  panels/*.tsx (config UIs)   │
│         │                    │       │  validate.ts (graph checks)  │
│         │ stdin/stdout       │       │                              │
│         ▼                    │       └──────────────────────────────┘
│  ┌──────────────┐            │
│  │  lace CLI    │            │
│  │  (Go binary) │            │
│  └──────────────┘            │
└──────────────────────────────┘
```

### Data Flow

```
User action (drop, connect, rename, configure...)
       │
       ▼
WorkspaceAction                   ← semantic action with module_key
       │
       ▼
workspaceReducer(state, action)   ← pure: (WorkspaceState, Action) → WorkspaceState
       │
       ▼
WorkspaceState                    ← ModuleBundle & { layouts }
       │
       ├── save ──→ JSON file in globalStorageUri
       ├── render ──→ deriveEdges(instances) ──→ ReactFlow nodes + edges
       └── generate ──→ toBundle(workspace) ──→ validate ──→ generate ──→ .tf files
```

## Project Structure

```
src/
├── extension.ts                  # VS Code activation, commands, tree views
├── persistence.ts                # JSON file store (zero native deps)
├── types/
│   └── protocol.ts               # Host↔webview typed message unions
├── utilities/engine/
│   ├── server-manager.ts         # Spawns lace CLI, manages lifecycle
│   └── rpc-client.ts             # JSON-RPC 2.0 over stdin/stdout
├── containers-views/             # Tree data providers (registry, components)
├── statusbar/                    # Engine status bar item
└── webview/
    ├── index.tsx                  # React entry point
    ├── App.tsx                    # ReactFlowProvider wrapper
    ├── Canvas.tsx                 # Main canvas: nodes, edges, panels, toolbar
    ├── state/
    │   ├── reducer.ts             # Pure reducer: 16 action types
    │   └── context.ts             # CanvasContext for node↔canvas communication
    ├── types/
    │   ├── ir.ts                  # Core IR types matching Go wire format exactly
    │   └── workspace.ts           # WorkspaceState = ModuleBundle & { layouts }
    ├── utils/
    │   ├── bundle.ts              # toBundle / fromBundle boundary functions
    │   ├── derive.ts              # Derive edges + wires from out bindings
    │   ├── validate.ts            # Graph validation (duplicates, dangling refs)
    │   ├── resolve.ts             # Schema resolution for instances
    │   ├── identifiers.ts         # Terraform identifier validation/generation
    │   └── record.ts              # mapRecord / filterRecord utilities
    ├── components/
    │   ├── nodes/
    │   │   ├── ModuleNode.tsx     # Leaf module node (with error highlighting)
    │   │   └── CompositeNode.tsx  # Composite node (double-click to navigate in)
    │   ├── panels/
    │   │   ├── ModuleConfigPanel.tsx      # Instance inputs + depends_on
    │   │   ├── EdgeConfigPanel.tsx        # Wire binding configuration
    │   │   ├── VariablesPanel.tsx         # Composite input interface
    │   │   ├── OutputsPanel.tsx           # Composite output exports
    │   │   ├── TerraformConfigPanel.tsx   # required_version, providers, backend
    │   │   ├── ProvidersPanel.tsx         # Provider blocks with aliases
    │   │   ├── LocalsPanel.tsx            # Locals with literal/expression modes
    │   │   └── EnvironmentsPanel.tsx      # Per-env variables + backends
    │   ├── sidebars/
    │   │   └── RegistrySidebar.tsx        # Module search + drag source
    │   ├── Breadcrumb.tsx                 # Composite navigation breadcrumb
    │   └── ErrorBoundary.tsx              # React error boundary
    ├── getWebviewContent.ts       # HTML shell + toolbar buttons
    ├── createWebviewPanel.ts      # Host-side message handler + validation flow
    └── __tests__/
        ├── fixtures/              # Real CLI bundle snapshots
        ├── bundle.test.ts         # toBundle/fromBundle round-trip
        ├── reducer.test.ts        # Core editing, interface, and grouping actions
        ├── phase4.test.ts         # Terraform config actions + integration
        ├── validate.test.ts       # Graph validation scenarios
        ├── grouping.test.ts       # GROUP_INTO_COMPOSITE edge cases
        ├── derive.test.ts         # Edge/wire derivation
        ├── normalize.test.ts      # Binding normalization
        ├── identifiers.test.ts    # Identifier validation/collision
        └── scaffold.test.ts       # Empty workspace scaffold
```

## Core Concepts

### Module Bundle

The wire format exchanged between the extension and CLI. A `ModuleBundle` contains a flat map of `ModuleDef` entries (keyed as `id@version`) and an `entry` reference pointing to the root composite.

### Workspace State

`WorkspaceState = ModuleBundle & { layouts }`. The `layouts` record stores per-composite node positions for the canvas. `toBundle()` strips layouts; `fromBundle()` adds them.

### Binding System

Every instance input is a discriminated union — exactly one variant is set:

| Variant | Shape                              | Meaning                                |
| ------- | ---------------------------------- | -------------------------------------- |
| `lit`   | `{ lit: any }`                     | Literal value (string, number, object) |
| `var`   | `{ var: "name" }`                  | Reference to a composite variable      |
| `out`   | `{ out: { module, name } }`        | Output of a sibling instance           |
| `expr`  | `{ expr: { lang: "hcl", value } }` | Raw HCL expression                     |

### Instance Types

Instances are discriminated by `kind`: `module` (references another `ModuleDef` via `use`), `resource` (Terraform resource), or `data` (Terraform data source).

### Wires

Wires are **never stored** in workspace state. They are derived from `out` bindings in `toBundle()` and stripped by `fromBundle()`. This is a core invariant.

## Reducer Actions

All state transitions go through a pure reducer: `(WorkspaceState, WorkspaceAction) → WorkspaceState`.

| Action                     | Category  | Purpose                                              |
| -------------------------- | --------- | ---------------------------------------------------- |
| `DROP_BUNDLE`              | Core      | Merge registry module into active composite          |
| `CONNECT`                  | Core      | Wire source output → target input                    |
| `DISCONNECT`               | Core      | Remove an input binding                              |
| `UPDATE_INPUTS`            | Core      | Bulk-update instance inputs                          |
| `RENAME_INSTANCE`          | Core      | Rename with cascade to bindings, exports, depends_on |
| `DELETE_INSTANCE`          | Core      | Remove instance + clean up all references            |
| `SYNC_LAYOUT`              | Core      | Bulk-update node positions (drag-end)                |
| `LOAD_WORKSPACE`           | Core      | Replace entire state (initial load)                  |
| `SET_VARIABLES`            | Interface | Edit composite input interface                       |
| `SET_EXPORTS`              | Interface | Edit composite output exports                        |
| `GROUP_INTO_COMPOSITE`     | Grouping  | Extract instances into a new nested composite        |
| `SET_TERRAFORM`            | Terraform | Set terraform block (version, providers, backend)    |
| `SET_PROVIDERS`            | Terraform | Set provider configurations                          |
| `SET_LOCALS`               | Terraform | Set local value definitions                          |
| `SET_DEPENDS_ON`           | Terraform | Set explicit dependencies on an instance             |
| `SET_ENVIRONMENTS`         | Terraform | Set per-environment variable overrides               |
| `SET_ENVIRONMENT_BACKENDS` | Terraform | Set per-environment backend configs                  |

## Validation

Two validation layers run before code generation:

1. **Graph validation** (instant, local) — `validateWorkspace()` checks for duplicate IDs, dangling `out` bindings, dangling `depends_on`, unknown `use` references, and dangling export references. Errors highlight affected nodes with red borders and tooltips.

2. **Terraform validation** (RPC) — The CLI's `validate` endpoint checks bundle structure and returns structured diagnostics. Only `severity: "error"` diagnostics abort generation.

## Generated Output

The CLI produces a complete Terraform project:

```
generate-{component}/
├── main.tf              # Module blocks for each instance
├── variables.tf         # Input variable declarations
├── outputs.tf           # Output value declarations
├── versions.tf          # required_version + required_providers
├── backend.tf           # Backend configuration
├── providers.tf         # Provider blocks (with aliases)
├── locals.tf            # Local value definitions
├── module.meta.json     # Instance → module mappings
└── envs/
    ├── dev/
    │   ├── main.tf          # module "root" { source = "../../" }
    │   ├── dev.tfvars       # Environment-specific values
    │   ├── variables.tf     # Variables (no defaults)
    │   └── backend.tf       # Environment-specific backend
    └── prod/
        ├── main.tf
        ├── prod.tfvars
        ├── variables.tf
        └── backend.tf
```

## Testing

```bash
npm test              # Run all 90 tests
npm run test:watch    # Watch mode
```

Test suites cover the entire logic layer without requiring React or VS Code:

| Suite                 | Tests | Coverage                                                           |
| --------------------- | ----- | ------------------------------------------------------------------ |
| `bundle.test.ts`      | 7     | `toBundle`/`fromBundle` round-trip, boundary errors                |
| `reducer.test.ts`     | 26    | Core editing, interface, and grouping actions                      |
| `phase4.test.ts`      | 18    | Terraform config actions, full bundle round-trip, integration flow |
| `validate.test.ts`    | 6     | Duplicate IDs, dangling refs, depends_on with `module.` prefix     |
| `grouping.test.ts`    | 13    | `GROUP_INTO_COMPOSITE` with cross-boundary wires, exports          |
| `derive.test.ts`      | 4     | Edge/wire derivation from out bindings                             |
| `normalize.test.ts`   | 7     | Binding normalization for all 4 variants                           |
| `identifiers.test.ts` | 8     | Terraform identifier validation, collision handling                |
| `scaffold.test.ts`    | 1     | Empty workspace construction                                       |

## Configuration

| Setting            | Default               | Description                                  |
| ------------------ | --------------------- | -------------------------------------------- |
| `lace.binaryPath`  | `/usr/local/bin/lace` | Path to the Lace CLI binary                  |
| `lace.autoStart`   | `true`                | Start CLI engine on extension activation     |
| `lace.autoRestart` | `true`                | Auto-restart engine on crash (up to 3 times) |

## Build System

- **Bundler**: [Rspack](https://rspack.dev/) with two entries — `extension.ts` (Node.js target) and `webview/index.tsx` (browser target)
- **Styling**: Tailwind CSS v4 via PostCSS
- **TypeScript**: Strict mode, `noUnusedLocals`, `noUnusedParameters`
- **Test runner**: Vitest
- **Formatting**: Prettier (enforced via lint-staged + Husky)
