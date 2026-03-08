import type { Bundle, Module, Use, Resource, Binding, OutputExport } from '../types/ir';
import type { WorkspaceState, GraphLayout } from '../types/workspace';
import { toTerraformIdentifier, makeModuleKey } from './identifiers';
import { allChildren } from './children';

// ── Layout Hints ──

export type LayoutHints = Record<string, Record<string, { x: number; y: number }>>;

// ── Parse Result ──

export type ParseResult = { workspace: WorkspaceState; errors: BoundaryError[] };
export type BoundaryError = { module_key?: string; instance_id?: string; message: string };

// ── Layout Constants ──

export const SPACING_X = 260;
export const SPACING_Y = 180;

// ══════════════════════════════════════════════════════════════════════
// toBundle
// ══════════════════════════════════════════════════════════════════════

export function toBundle(workspace: WorkspaceState): Bundle {
  const { layouts: _layouts, ...bundle } = workspace;
  return bundle;
}

// ══════════════════════════════════════════════════════════════════════
// fromBundle
// ══════════════════════════════════════════════════════════════════════

export function fromBundle(bundle: Bundle, hints?: LayoutHints): ParseResult {
  const errors: BoundaryError[] = [];
  const modules: Record<string, Module> = {};
  const layouts: Record<string, GraphLayout> = {};

  for (const [key, raw] of Object.entries(bundle.modules)) {
    try {
      const mod = normalizeModule(raw as any);
      modules[key] = mod;

      const children = allChildren(mod);
      const layout = children.length > 0 ? computeLayout(children, hints?.[key]) : { nodes: {} };
      layouts[key] = layout;
    } catch (err: any) {
      errors.push({ module_key: key, message: err.message });
    }
  }

  return {
    workspace: {
      schema_version: bundle.schema_version ?? '1.0',
      kind: 'bundle',
      entry: bundle.entry,
      modules,
      environments: bundle.environments,
      environment_backends: bundle.environment_backends,
      layouts,
    },
    errors,
  };
}

// ══════════════════════════════════════════════════════════════════════
// normalizeModule
// ══════════════════════════════════════════════════════════════════════

function normalizeModule(raw: any): Module {
  const uses = raw.modules?.map((u: any) => normalizeUse(u));
  const resources = raw.resources?.map((r: any) => normalizeResource(r));

  const rawExports = raw.exports?.outputs || {};
  const normalizedExports: Record<string, OutputExport> = {};
  for (const [name, exp] of Object.entries(rawExports)) {
    normalizedExports[name] = normalizeOutputExport(exp);
  }

  const locals = raw.locals
    ? raw.locals.map((l: any) => ({
        name: l.name,
        value: normalizeBinding(l.value),
      }))
    : undefined;

  return {
    id: raw.id,
    version: raw.version,
    ...(raw.source ? { source: raw.source } : {}),
    interface: raw.interface ?? { inputs: [], outputs: [] },
    ...(uses && uses.length > 0 ? { modules: uses } : {}),
    ...(resources && resources.length > 0 ? { resources } : {}),
    ...(locals ? { locals } : {}),
    exports: { outputs: normalizedExports },
    ...(raw.terraform ? { terraform: raw.terraform } : {}),
    ...(raw.providers ? { providers: raw.providers } : {}),
  };
}

function normalizeChildFields(raw: any): {
  inputs?: Record<string, Binding>;
  depends_on?: string[];
} {
  const inputs: Record<string, Binding> = {};
  if (raw.inputs) {
    for (const [name, val] of Object.entries(raw.inputs)) {
      inputs[name] = normalizeBinding(val);
    }
  }
  return {
    ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
    ...(raw.depends_on ? { depends_on: raw.depends_on } : {}),
  };
}

function normalizeUse(raw: any): Use {
  return { id: raw.id, module: raw.module, ...normalizeChildFields(raw) };
}

function normalizeResource(raw: any): Resource {
  return { id: raw.id, kind: raw.kind, type: raw.type, ...normalizeChildFields(raw) };
}

// ══════════════════════════════════════════════════════════════════════
// normalizeBinding / normalizeOutputExport
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize a raw binding/export from the Go wire format into exactly one
 * discriminated union variant: { out }, { var }, { expr }, or { lit }.
 *
 * Expected input shape (Go Binding with omitempty):
 *   { out?: { module, name }, var?: string, expr?: { lang, value }, lit?: any }
 */
function normalizeBindingShape(raw: any): Binding {
  if (raw.out && raw.out.module && raw.out.name) {
    return { out: { module: raw.out.module, name: raw.out.name } };
  }
  if (typeof raw.var === 'string' && raw.var !== '') {
    return { var: raw.var };
  }
  if (raw.expr && raw.expr.lang && raw.expr.value) {
    return { expr: { lang: raw.expr.lang, value: raw.expr.value } };
  }
  return { lit: raw.lit ?? null };
}

export function normalizeBinding(raw: any): Binding {
  return normalizeBindingShape(raw);
}

function normalizeOutputExport(raw: any): OutputExport {
  return normalizeBindingShape(raw) as OutputExport;
}

// ══════════════════════════════════════════════════════════════════════
// computeLayout
// ══════════════════════════════════════════════════════════════════════

export function computeLayout(
  children: ReadonlyArray<{ id: string }>,
  existing?: Record<string, { x: number; y: number }>,
): GraphLayout {
  const nodes: Record<string, { position: { x: number; y: number } }> = {};
  const n = children.length;
  const cols = Math.max(2, Math.ceil(Math.sqrt(n)));

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (existing && existing[child.id]) {
      nodes[child.id] = { position: existing[child.id] };
    } else {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes[child.id] = { position: { x: col * SPACING_X, y: row * SPACING_Y } };
    }
  }

  return { nodes };
}

// ── Empty workspace factory ──

export function emptyWorkspace(name: string): WorkspaceState {
  const root_id = toTerraformIdentifier(name);
  const root_key = makeModuleKey(root_id, 'v1.0.0');
  return {
    schema_version: '1.0',
    kind: 'bundle',
    entry: root_key,
    modules: {
      [root_key]: {
        id: root_id,
        version: 'v1.0.0',
        interface: { inputs: [], outputs: [] },
        exports: { outputs: {} },
      },
    },
    layouts: { [root_key]: { nodes: {} } },
  };
}
