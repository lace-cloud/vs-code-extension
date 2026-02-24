---
name: lace-ui
description: >
  Technical constraints and design standards for the Lace VS Code extension
  UI. Use when working on Canvas.tsx, App.tsx, index.tsx, index.css,
  state/context.ts, any component in components/panels/ or components/nodes/,
  or any task with a visual or interaction design dimension in the webview.
---

## Environment Constraint

Webview code runs in a browser sandbox inside VS Code. NEVER import:

- `vscode` module or any VS Code API
- Node.js built-ins (`fs`, `path`, `child_process`)
- Anything from `src/utilities/engine/` or `src/containers-views/`

The extension host and webview are separate Rspack entries sharing only
types. They run in different JavaScript environments.

**Note:** `createWebviewPanel.ts` and `ModuleDetailPanel.ts` live in
`src/webview/` but run in Node.js (they import `vscode`). They belong
to lace-host, not this skill.

## Brand Identity

Lace is a visual IaC composition tool. The name is literal — weaving
infrastructure modules together. Three visual pillars define the brand:
the engineering graph-paper grid (the "loom" everything sits on), the
interlocking loop monogram, and dynamic rounded shapes.

**Design direction:** Developer tool precision (Figma, Linear) meets the
Lace brand — rounded forms, the ever-present engineering grid, and the
confidence of a tool that knows what it is. The grid is the visual
foundation: every canvas view sits on it like a drafting surface.

## Color Palette

### Primary (from brand guide — do not modify)

```
Green Yellow:    #CEFE65   — Primary accent
Gunmetal:        #153238   — Secondary surfaces, controls
Night:           #161616   — Canvas background, deepest surfaces
White:           #FFFFFF   — High-contrast text on dark
```

### Secondary (from brand guide)

```
Non Photo Blue:  #95E7FF   — Composite/structural indicators, links
Bright Grey:     #ECEFED   — Body text on dark when white is too stark
```

### Surface Palette (derived for UI depth)

```
Surface 0 (inset):   #0f0f0f   — Input fields, recessed areas
Surface 1 (panels):  #1e1e1e   — Side panels, overlays
Surface 2 (elevated):#252525   — Cards, dropdowns, popovers
Surface 3 (hover):   #2a2a2a   — Hover states on Surface 1
Border subtle:       #333333   — Panel borders, dividers
Border accent:       rgba(206, 254, 101, 0.15)
```

### Color Semantics

- **#CEFE65 = data flow.** Edges, handles, connection labels, wired badges.
  This is the "wiring" color — Lace's core metaphor. Not for generic buttons.
- **#1f6feb = actions.** Save buttons, active mode toggles.
- **#95E7FF = structure.** Composite handles, schema type labels, links.
- **#e5484d = error/destructive.** Validation errors, delete.
- **#153238 = elevated surfaces.** Controls panel, status badges.

### AAA Pairings (verified in brand guide)

Green Yellow on Night ✓ | Green Yellow on Gunmetal ✓
Night on Green Yellow ✓ | Gunmetal on Green Yellow ✓
Night on Non Photo Blue / Bright Grey / White ✓
Use these. Do not invent new foreground/background combinations.

## Typography

**Font:** Instrument Sans (Google Fonts). Weights: 400, 500, 600, 700.
**Monospace:** `font-mono` (Tailwind default) for code values and HCL.

```
Panel title:     16px  Semibold  (#ECEFED)
Section header:  13px  Bold      uppercase tracking-wide opacity-85
Label:           12px  Semibold  opacity-90
Body/value:      12px  Regular   (#ECEFED or opacity-65 for secondary)
Caption/badge:   10-11px Regular  opacity-60
Micro (wired):   7px   Regular   opacity-60 (ambient info only)
```

Use weight and opacity for hierarchy — not borders, dividers, or color.

## Brand Elements

### Engineering Grid (Central Brand Element)

The graph-paper grid is the primary visual expression of Lace's "weaving"
metaphor. It is not decoration — it is the visual foundation the entire
canvas sits on, like an engineer's drafting surface.

**Current implementation** (custom CSS on the ReactFlow container, NOT the
ReactFlow `<Background />` component):

```
Fine grid:   16×16px   rgba(206,254,101, 0.035)  — subtle cross-hatch
Major grid:  80×80px   rgba(206,254,101, 0.07)   — visible structure lines
```

Both layers are fixed — they do NOT zoom or pan with the graph. This is
intentional: the grid is the stable surface, nodes float above it.

**Rules for the grid:**

- Always present on the canvas. Never remove it or make it toggleable.
- Always #CEFE65-tinted — the green tint ties it to the brand palette.
  Never use neutral grey gridlines.
- Two-tier density (fine + major) creates the engineering-paper feel.
  Do not flatten to a single grid size.
- Fixed positioning is load-bearing. If you switch to ReactFlow's
  `<Background />` component (which zooms/pans), you lose the drafting-
  surface metaphor. Only do this if explicitly asked.
- When building new full-screen views (welcome screens, onboarding, empty
  states), reuse this same grid pattern to maintain visual continuity.
  Copy the `gridStyle` object or extract it into a shared constant.

### Rounded Shapes

The brand's primary design element — the logo's interlocking loop. Translates
to: `rounded-lg` (8px) panels/inputs, `rounded-full` pills/toggles, bezier
edges in ReactFlow. Avoid sharp rectangles. Soft corners echo the brand.

### Logo in Extension

Monogram appears in sidebar header, empty states, loading screens.
Use colored version (#CEFE65) on dark. Monochrome only when colored lacks
contrast. Maintain clear space ≥ icon dimensions. Never distort, recolor,
or add effects.

## ReactFlow v12 Patterns

### Node Components

```typescript
type ModuleNodeNode = Node<ModuleNodeData, 'moduleNode'>;
const ModuleNode: React.FC<NodeProps<ModuleNodeNode>> = ({ id, data }) => {
```

### Node Data Is Serializable

`ModuleNodeData` contains NO callbacks. Communication from nodes:

- Dispatch via `(window as any).__canvasDispatch` (intentional pattern)
- Module key via `(window as any).__activeModuleKey`
- `CanvasContext` for `openConfig`, `markDirty`

ReactFlow node rendering doesn't support prop drilling. Do not refactor
this away.

### Edge Derivation

Edges are derived from workspace state via `deriveEdges(graph.instances)`.
Never stored. Edge state is local to `CompositeEditor` for selection only,
resets when workspace state changes.

## Host ↔ Webview Communication

Discriminated unions in `src/types/protocol.ts`. No shared memory.

```typescript
// Send to host:
window.vscode.postMessage(msg: WebviewToHost);
// Receive from host: message event listener in Canvas.tsx useEffect
```

**Host → Webview:** `loadState`, `triggerSave`, `triggerGenerate`,
`generateSuccess`, `generateError`, `dropBundle`, `validationErrors`,
`triggerVariables`, `triggerOutputs`, `triggerTerraformConfig`,
`triggerProviders`, `triggerLocals`, `triggerEnvironments`

**Webview → Host:** `webviewReady`, `saveState`, `generateBundle`, `markDirty`

Never bypass this protocol.

## Canvas.tsx Architecture

### CompositeEditor / Canvas Split

Canvas.tsx contains both `Canvas` (outer) and `CompositeEditor` (inner).
Separated so CompositeEditor's hooks (useMemo for rfNodes/rfEdges) only
mount when a valid composite graph exists. Canvas can safely early-return
`<ErrorState>` without triggering React's "rendered fewer hooks" error.
Do not merge them. If extracting from Canvas.tsx, keep this separation.

### Panel State

7 panels use independent boolean states with mutually exclusive toggle
logic. Adding a new panel: add the boolean, add the message handler case
that sets it true and all others false. Known code smell — do not attempt
to refactor as part of a feature task.

## Component Visual Specs

### Nodes (42×42px)

Small enough for 20+ module graphs. Do not enlarge.

- Quiet at rest → informative on hover (handles appear) → prominent when active
- Labels: 12px below. Wired badges: 7px ambient.
- Error: `1.5px solid #e5484d` + `shadow 0 0 8px rgba(229,72,77,0.3)`
- Connected handles: 0.7 opacity persistent. Unconnected: appear on hover.

### Panels (right-side, 420px wide)

```
┌─────────────────────────┐
│ Section ─────── [Close] │  header: p-4 border-b border-[#333]
├─────────────────────────┤
│ Content                 │  body: flex-1 overflow-y-auto p-4 pb-24
├─────────────────────────┤
│ [  Primary Action  ]    │  footer: sticky bottom-0 border-t bg-[#1e1e1e]
└─────────────────────────┘
```

- Inputs: `bg-[#0f0f0f] border border-[#333] rounded-lg px-2.5 py-2.5 text-xs`
- Section titles: `h4` 13px bold uppercase tracking-wide opacity-85
- Close: `border border-[#333] bg-[#0f0f0f] rounded-lg w-[34px] h-[34px]`
- Primary action: `bg-[#1f6feb] text-white rounded-[10px] font-bold`

### Toolbar

Gunmetal backgrounds, lime SVG icons 13×13px. Hover: `fill: #e0ff8a`.

### Status Toast

Top-left: `bg-[#153238] text-[#CEFE65]` accent border, 5s auto-dismiss.

## Interaction Patterns

- Node click → open config panel
- Node double-click → inline rename
- Node hover → reveal handles + delete button
- Edge click → open edge config panel
- Canvas click (empty) → close all panels
- Cmd+S → save workspace
- Module drop from sidebar via host message (not native drag-and-drop)
- Node positions local until drag stops → SYNC_LAYOUT

## Styling Rules

- Tailwind CSS v4 utilities only. No component CSS files.
- Global overrides in `index.css` only (ReactFlow theming).
- Opacity on brand colors over new hex values:
  `text-[#ECEFED] opacity-65` not `text-[#9a9c9b]`
- Border radius: `rounded-lg` panels/inputs, `rounded-sm` nodes/badges,
  `rounded-full` pills/toggles.
- Shadows: minimal. `shadow-[0_2px_8px_rgba(0,0,0,0.4)]` for controls.
- Motion: functional only. 150-200ms ease-out. No decorative animation.
- Function components with hooks only. No class components.
- State: `useReducer` with `workspaceReducer` at Canvas level.
- Panels receive state and dispatch via props, not context directly.

## What to Avoid

- Importing vscode/Node.js APIs in webview code
- Putting callbacks in ModuleNodeData
- Generic chrome with no brand identity
- Gradient backgrounds, glassmorphism
- #CEFE65 on everything — it's the wiring color
- Large padding (consumer app feel, not dev tool)
- Sharp rectangles (breaks brand's rounded identity)
- Multiple accent colors competing in one view
