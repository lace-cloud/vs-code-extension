import type { Edge } from 'react-flow-renderer';

/* ---------------------------------- */
/* Types                              */
/* ---------------------------------- */

type ModuleSchema = {
  inputs?: Array<any>;
  outputs?: Array<any>;
};

type NodeModuleRef = {
  id: string;
  name: string;
  system: string;
  version: string;
  kind: 'leaf' | 'composite';
  categories?: string[];
  module_path?: string;
  git_url?: string;
  schema?: ModuleSchema;
};

/* ---------------------------------- */
/* Helpers                            */
/* ---------------------------------- */

function toLitBindings(config: Record<string, any>) {
  const result: Record<string, any> = {};
  Object.entries(config || {}).forEach(([key, value]) => {
    if (value === undefined || value === '') {
      return;
    }
    result[key] = { lit: value };
  });
  return result;
}

function parseTerraformGitSource(gitUrl?: string): { repo: string; subdir?: string; ref?: string } {
  if (!gitUrl) {
    return { repo: '' };
  }

  let s = gitUrl.trim();
  if (s.startsWith('git::')) {
    s = s.slice('git::'.length);
  }

  const [beforeQ, query] = s.split('?');
  const ref = query?.startsWith('ref=') ? query.slice('ref='.length) : undefined;

  const marker = '//';
  const idx = beforeQ.indexOf(marker, beforeQ.indexOf('://') + 3);
  if (idx === -1) {
    return { repo: beforeQ, ref };
  }

  const repo = beforeQ.slice(0, idx);
  const subdir = beforeQ.slice(idx + marker.length);
  return { repo, subdir, ref };
}

function sanitizeOutputName(s: string) {
  return (s || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '_');
}

/* ---------------------------------- */
/* graphToJson                        */
/* ---------------------------------- */

export default function graphToJson(nodesInput: any[], edgesInput: Edge<any>[]) {
  const canvasNodes = (nodesInput ?? []).filter((n) => n?.data?.moduleRef);
  if (canvasNodes.length === 0) {
    return null;
  }

  const modules: Record<string, any> = {};

  // leaf module defs
  for (const node of canvasNodes) {
    const ref: NodeModuleRef = node.data.moduleRef;

    const moduleId = ref.module_path || ref.name;
    const version = ref.version?.startsWith('v') ? ref.version : `v${ref.version || '1.0.0'}`;
    const leafKey = `${moduleId}@${version}`;

    const schema: ModuleSchema | undefined = ref.schema || node.data.schema;
    const inputs = schema?.inputs ?? [];
    const outputs = schema?.outputs ?? [];

    const { repo, subdir } = parseTerraformGitSource(ref.git_url);

    modules[leafKey] = {
      schema_version: '1.0',
      kind: 'module_def',
      id: moduleId,
      version,
      interface: { inputs, outputs },
      impl: {
        kind: 'leaf',
        source: {
          kind: 'git',
          repo,
          subdir: subdir || ref.module_path,
          ref: version,
        },
      },
    };
  }

  // composite wrapper (entry)
  const compositeId = `deploy-${Date.now()}`;
  const compositeVersion = 'v1.0.0';
  const compositeKey = `${compositeId}@${compositeVersion}`;

  // wires + wired input overrides for each target node
  const wires: any[] = [];
  const wiredInputsByTarget: Record<string, Record<string, any>> = {};

  for (const e of edgesInput || []) {
    const mapping = (e.data as any)?.mapping as { from?: string; to?: string } | undefined;
    if (!mapping?.from || !mapping?.to) {
      continue;
    }

    wires.push({
      from: { module: e.source, port: `outputs.${mapping.from}` },
      to: { module: e.target, port: `inputs.${mapping.to}` },
    });

    if (!wiredInputsByTarget[e.target]) {
      wiredInputsByTarget[e.target] = {};
    }
    wiredInputsByTarget[e.target][mapping.to] = {
      out: { module: e.source, name: mapping.from },
    };
  }

  // exports
  const exportOutputs: Record<string, any> = {};
  const compositeInterfaceOutputs: any[] = [];

  const isSingle = canvasNodes.length === 1;

  for (const node of canvasNodes) {
    const ref: NodeModuleRef = node.data.moduleRef;
    const schema: ModuleSchema | undefined = ref.schema || node.data.schema;
    const outs = schema?.outputs ?? [];

    for (const out of outs) {
      const outName = out?.name;
      if (!outName) {
        continue;
      }

      const exportedName = isSingle
        ? outName
        : `${sanitizeOutputName(node.id)}__${sanitizeOutputName(outName)}`;

      compositeInterfaceOutputs.push({
        name: exportedName,
        type: out?.type || 'any',
        ...(out?.description ? { description: out.description } : {}),
      });

      exportOutputs[exportedName] = {
        out: { module: node.id, name: outName },
      };
    }
  }

  // composite module def
  modules[compositeKey] = {
    schema_version: '1.0',
    kind: 'module_def',
    id: compositeId,
    version: compositeVersion,
    interface: { inputs: [], outputs: compositeInterfaceOutputs },
    impl: {
      kind: 'composite',
      graph: {
        instances: canvasNodes.map((node) => {
          const ref: NodeModuleRef = node.data.moduleRef;
          const moduleId = ref.module_path || ref.name;
          const version = ref.version?.startsWith('v') ? ref.version : `v${ref.version || '1.0.0'}`;

          const litInputs = toLitBindings(node.data.config || {});
          const wired = wiredInputsByTarget[node.id] || {};
          const mergedInputs = { ...litInputs, ...wired };

          return {
            id: node.id,
            use: { module_id: moduleId, version },
            inputs: mergedInputs,
          };
        }),
        wires,
        exports: { outputs: exportOutputs },
      },
    },
  };

  return {
    schema_version: '1.0',
    kind: 'module_bundle',
    entry: { module_id: compositeId, version: compositeVersion },
    modules,
  };
}
