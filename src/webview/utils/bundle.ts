import type {
  ModuleBundle,
  ModuleDef,
  Binding,
  OutputExport,
  Instance,
  ModuleInstance,
  ResourceInstance,
  DataInstance,
  CompositeGraph,
} from '../types/ir';
import type { WorkspaceState, GraphLayout } from '../types/workspace';
import { mapRecord } from './record';
import { deriveWires } from './derive';
import { toTerraformIdentifier } from './identifiers';

// ── Layout Hints ──

export type LayoutHints = Record<string, Record<string, { x: number; y: number }>>;

// ── Parse Result ──

export type ParseResult = { workspace: WorkspaceState; errors: BoundaryError[] };
export type BoundaryError = { module_key?: string; instance_id?: string; message: string };

// ── Parsed Entry (internal) ──

type ParsedEntry = { def: ModuleDef; layout?: GraphLayout };

// ── Layout Constants ──

const SPACING_X = 260;
const SPACING_Y = 180;

// ══════════════════════════════════════════════════════════════════════
// toBundle
// ══════════════════════════════════════════════════════════════════════

export function toBundle(workspace: WorkspaceState): ModuleBundle {
  const { layouts: _layouts, ...bundle } = workspace;
  return { ...bundle, modules: mapRecord(bundle.modules, injectWires) };
}

function injectWires(def: ModuleDef): ModuleDef {
  if (def.impl.kind !== 'composite') {
    return def;
  }
  return {
    ...def,
    impl: {
      ...def.impl,
      graph: {
        ...def.impl.graph,
        wires: deriveWires(def.impl.graph.instances),
      },
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// fromBundle
// ══════════════════════════════════════════════════════════════════════

export function fromBundle(bundle: ModuleBundle, hints?: LayoutHints): ParseResult {
  const errors: BoundaryError[] = [];
  const parsed = Object.entries(bundle.modules).reduce<{
    modules: Record<string, ModuleDef>;
    layouts: Record<string, GraphLayout>;
  }>(
    (acc, [key, raw]) => {
      try {
        const entry = parseModuleDef(key, raw as any, hints);
        return {
          modules: { ...acc.modules, [key]: entry.def },
          layouts: entry.layout ? { ...acc.layouts, [key]: entry.layout } : acc.layouts,
        };
      } catch (err: any) {
        errors.push({ module_key: key, message: err.message });
        return acc;
      }
    },
    { modules: {}, layouts: {} },
  );

  return {
    workspace: {
      schema_version: '1.0',
      kind: 'module_bundle',
      entry: bundle.entry,
      modules: parsed.modules,
      environments: bundle.environments,
      environment_backends: bundle.environment_backends,
      layouts: parsed.layouts,
    },
    errors,
  };
}

// ══════════════════════════════════════════════════════════════════════
// parseModuleDef
// ══════════════════════════════════════════════════════════════════════

function parseModuleDef(key: string, raw: any, hints?: LayoutHints): ParsedEntry {
  if (!raw.impl || !raw.impl.kind) {
    throw new Error(`Module "${key}" has no impl.kind`);
  }

  if (raw.impl.kind === 'leaf') {
    return { def: raw as ModuleDef };
  }

  if (raw.impl.kind === 'composite') {
    const graph = raw.impl.graph;
    if (!graph) {
      throw new Error(`Composite module "${key}" has no graph`);
    }

    // Normalize instances
    const instances: Instance[] = (graph.instances || []).map((inst: any) =>
      normalizeInstance(inst),
    );

    // Normalize exports
    const rawExports = graph.exports?.outputs || {};
    const normalizedExports: Record<string, OutputExport> = {};
    for (const [name, exp] of Object.entries(rawExports)) {
      normalizedExports[name] = normalizeOutputExport(exp);
    }

    // Normalize locals
    const locals = graph.locals
      ? graph.locals.map((l: any) => ({
          name: l.name,
          value: normalizeBinding(l.value),
        }))
      : undefined;

    // Strip wires — they are derived, not stored in workspace
    const normalizedGraph: CompositeGraph = {
      instances,
      exports: { outputs: normalizedExports },
      ...(locals ? { locals } : {}),
    };

    // Remove wires key entirely (destructured above, not in restGraph)
    const def: ModuleDef = {
      ...raw,
      impl: { kind: 'composite' as const, graph: normalizedGraph },
    };

    // Compute layout
    const layout = computeLayout(instances, hints?.[key]);

    return { def, layout };
  }

  throw new Error(`Module "${key}" has unknown impl.kind: "${raw.impl.kind}"`);
}

// ══════════════════════════════════════════════════════════════════════
// normalizeInstance
// ══════════════════════════════════════════════════════════════════════

function normalizeInstance(raw: any): Instance {
  const kind = raw.kind || 'module';
  const inputs: Record<string, Binding> = {};
  if (raw.inputs) {
    for (const [name, val] of Object.entries(raw.inputs)) {
      inputs[name] = normalizeBinding(val);
    }
  }

  const base = {
    id: raw.id,
    inputs,
    ...(raw.depends_on ? { depends_on: raw.depends_on } : {}),
  };

  if (kind === 'resource') {
    return { ...base, kind: 'resource', type: raw.type } as ResourceInstance;
  }
  if (kind === 'data') {
    return { ...base, kind: 'data', type: raw.type } as DataInstance;
  }

  // Default: module
  return { ...base, kind: 'module', use: raw.use } as ModuleInstance;
}

// ══════════════════════════════════════════════════════════════════════
// normalizeBinding
// ══════════════════════════════════════════════════════════════════════

export function normalizeBinding(raw: any): Binding {
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

// ══════════════════════════════════════════════════════════════════════
// normalizeOutputExport
// ══════════════════════════════════════════════════════════════════════

export function normalizeOutputExport(raw: any): OutputExport {
  // Same logic as normalizeBinding — same shapes
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

// ══════════════════════════════════════════════════════════════════════
// computeLayout
// ══════════════════════════════════════════════════════════════════════

export function computeLayout(
  instances: Instance[],
  existing?: Record<string, { x: number; y: number }>,
): GraphLayout {
  const nodes: Record<string, { position: { x: number; y: number } }> = {};
  const n = instances.length;
  const cols = Math.max(2, Math.ceil(Math.sqrt(n)));

  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    if (existing && existing[inst.id]) {
      nodes[inst.id] = { position: existing[inst.id] };
    } else {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes[inst.id] = { position: { x: col * SPACING_X, y: row * SPACING_Y } };
    }
  }

  return { nodes };
}

// ── Empty workspace factory ──

export function emptyWorkspace(name: string): WorkspaceState {
  const root_id = toTerraformIdentifier(name);
  const root_key = `${root_id}@v1.0.0`;
  return {
    schema_version: '1.0',
    kind: 'module_bundle',
    entry: { module_id: root_id, version: 'v1.0.0' },
    modules: {
      [root_key]: {
        schema_version: '1.0',
        kind: 'module_def',
        id: root_id,
        version: 'v1.0.0',
        interface: { inputs: [], outputs: [] },
        impl: {
          kind: 'composite',
          graph: { instances: [], exports: { outputs: {} } },
        },
      },
    },
    layouts: { [root_key]: { nodes: {} } },
  };
}
