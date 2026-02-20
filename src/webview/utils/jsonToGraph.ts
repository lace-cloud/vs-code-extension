import type { Edge } from 'react-flow-renderer';

/* ---------------------------------- */
/* Types                              */
/* ---------------------------------- */

/** Shape returned by registry/version for a composite module */
type CompositeVersionData = {
  kind: 'composite';
  system: string;
  name: string;
  version: string;
  module_path?: string;
  git_url?: string;
  schema?: { inputs?: any[]; outputs?: any[] };
  bundle: {
    schema_version: string;
    kind: string;
    entry: { module_id: string; version: string };
    modules: Record<string, ModuleDef>;
  };
};

type ModuleDef = {
  schema_version: string;
  kind: string;
  id: string;
  version: string;
  description?: string;
  interface: { inputs: any[]; outputs: any[] };
  impl: {
    kind: 'leaf' | 'composite';
    source?: { kind: string; repo?: string; subdir?: string; ref?: string };
    graph?: {
      instances: GraphInstance[];
      wires: GraphWire[];
      exports?: { outputs?: Record<string, any> };
    };
  };
};

type GraphInstance = {
  id: string;
  use?: { module_id: string; version: string };
  inputs?: Record<string, any>;
  kind?: string; // 'resource' for raw TF resources
  type?: string;
  depends_on?: string[];
};

type GraphWire = {
  from: { module: string; port: string };
  to: { module: string; port: string };
};

type CanvasNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
};

export type CompositeGraphResult = {
  nodes: CanvasNode[];
  edges: Edge<any>[];
};

/* ---------------------------------- */
/* Helpers                            */
/* ---------------------------------- */

/** Extract the output name from a wire port string like "outputs.queue_url" */
function parsePort(port: string): string {
  const dot = port.indexOf('.');
  return dot === -1 ? port : port.slice(dot + 1);
}

/** Convert an instance input map back into a config object (only `lit` bindings). */
function extractConfig(inputs: Record<string, any> | undefined): Record<string, any> {
  const config: Record<string, any> = {};
  if (!inputs) {
    return config;
  }

  for (const [key, binding] of Object.entries(inputs)) {
    if (binding && 'lit' in binding) {
      // { lit: value } — the value might be empty object for default
      const val = binding.lit;
      if (
        val !== undefined &&
        val !== null &&
        !(typeof val === 'object' && Object.keys(val).length === 0)
      ) {
        config[key] = val;
      }
    }
  }
  return config;
}

/** Build wiredInputs from instance inputs that use `{ out: { module, name } }` bindings. */
function extractWiredInputs(
  inputs: Record<string, any> | undefined,
  instanceIdToNodeId: Record<string, string>,
): Record<string, string> {
  const wired: Record<string, string> = {};
  if (!inputs) {
    return wired;
  }

  for (const [key, binding] of Object.entries(inputs)) {
    if (binding && 'out' in binding) {
      const { module: srcModule, name: outputName } = binding.out;
      // Use the canvas node ID for the Terraform reference to match onConnect behavior
      const tfModuleName = instanceIdToNodeId[srcModule] ?? srcModule;
      wired[key] = `module.${tfModuleName}.${outputName}`;
    }
  }
  return wired;
}

/** Find the module def key in the bundle modules map by module_id and version. */
function findModuleDef(
  modules: Record<string, ModuleDef>,
  moduleId: string,
  version: string,
): ModuleDef | undefined {
  // Try exact key: "moduleId@version"
  const exactKey = `${moduleId}@${version}`;
  if (modules[exactKey]) {
    return modules[exactKey];
  }

  // Fallback: search by id + version fields
  return Object.values(modules).find((m) => m.id === moduleId && m.version === version);
}

/* ---------------------------------- */
/* compositeToGraph                   */
/* ---------------------------------- */

/**
 * Converts a composite module's version data into canvas nodes and edges.
 * This is the reverse of graphToJson — it takes the bundle JSON and
 * produces the React Flow graph representation.
 */
export default function jsonToGraph(
  data: CompositeVersionData,
  dropPosition: { x: number; y: number },
): CompositeGraphResult {
  const bundle = data.bundle;
  if (!bundle?.modules || !bundle.entry) {
    return { nodes: [], edges: [] };
  }

  // Find the composite entry module def
  const entryDef = findModuleDef(bundle.modules, bundle.entry.module_id, bundle.entry.version);
  if (!entryDef || entryDef.impl?.kind !== 'composite' || !entryDef.impl.graph) {
    return { nodes: [], edges: [] };
  }

  const graph = entryDef.impl.graph;
  const instances = graph.instances ?? [];
  const wires = graph.wires ?? [];

  // Filter out raw TF resource instances (kind === 'resource')
  const moduleInstances = instances.filter((inst) => inst.kind !== 'resource');

  const timestamp = Date.now();

  // Layout: arrange nodes in a grid around the drop position
  const COLS = Math.max(2, Math.ceil(Math.sqrt(moduleInstances.length)));
  const SPACING_X = 220;
  const SPACING_Y = 160;

  // Map: instance.id → canvas node id
  const instanceIdToNodeId: Record<string, string> = {};
  moduleInstances.forEach((inst, idx) => {
    instanceIdToNodeId[inst.id] = `${data.system}-${inst.id}-${timestamp + idx}`;
  });

  // Build nodes
  const nodes: CanvasNode[] = [];

  moduleInstances.forEach((inst, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);

    const nodeId = instanceIdToNodeId[inst.id];
    const leafDef = inst.use
      ? findModuleDef(bundle.modules, inst.use.module_id, inst.use.version)
      : undefined;

    // e.g. "modules/aws/sqs/queue" → "sqs-queue", "modules/azure/storage/blob" → "storage-blob"
    const rawModuleId = inst.use?.module_id ?? '';
    const moduleIdParts = rawModuleId.split('/');
    // Strip "modules/<provider>/" prefix (first two segments) and join the rest with '-'
    const leafName =
      moduleIdParts.length > 2
        ? moduleIdParts.slice(2).join('-')
        : (moduleIdParts.pop() ?? inst.id);
    const leafVersion = inst.use?.version ?? '1.0.0';

    const schema = leafDef?.interface
      ? { inputs: leafDef.interface.inputs, outputs: leafDef.interface.outputs }
      : undefined;

    // Build git_url from leaf source if available
    let gitUrl: string | undefined;
    let modulePath: string | undefined;
    if (leafDef?.impl?.kind === 'leaf' && leafDef.impl.source) {
      const src = leafDef.impl.source;
      modulePath = src.subdir ?? leafDef.id;
      if (src.repo) {
        gitUrl = `git::${src.repo}//${src.subdir ?? ''}${src.ref ? `?ref=${src.ref}` : ''}`;
      }
    }

    const config = extractConfig(inst.inputs);
    const wiredInputs = extractWiredInputs(inst.inputs, instanceIdToNodeId);

    nodes.push({
      id: nodeId,
      type: 'awsNode',
      position: {
        x: dropPosition.x + col * SPACING_X,
        y: dropPosition.y + row * SPACING_Y,
      },
      data: {
        label: inst.id,
        moduleRef: {
          id: `${data.system}-${leafName}-${timestamp + idx}`,
          name: leafName,
          system: data.system,
          version: leafVersion,
          kind: 'leaf' as const,
          module_path: modulePath ?? leafDef?.id,
          git_url: gitUrl,
          schema,
        },
        schema,
        config: Object.keys(config).length > 0 ? config : undefined,
        wiredInputs: Object.keys(wiredInputs).length > 0 ? wiredInputs : undefined,
      },
    });
  });

  // Build edges from wires
  const edges: Edge<any>[] = [];

  wires.forEach((wire, idx) => {
    const sourceNodeId = instanceIdToNodeId[wire.from.module];
    const targetNodeId = instanceIdToNodeId[wire.to.module];

    // Skip wires involving resource instances (which were filtered out)
    if (!sourceNodeId || !targetNodeId) {
      return;
    }

    const fromPort = parsePort(wire.from.port); // e.g. "queue_url"
    const toPort = parsePort(wire.to.port); // e.g. "queue_url"

    const edgeId = `e-${sourceNodeId}-${targetNodeId}-${timestamp + idx}`;

    edges.push({
      id: edgeId,
      source: sourceNodeId,
      target: targetNodeId,
      type: 'default',
      animated: false,
      data: {
        mapping: { from: fromPort, to: toPort },
      },
    });
  });

  return { nodes, edges };
}
