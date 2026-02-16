import React, { useEffect, useState, useRef } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  Background,
  Controls,
} from 'react-flow-renderer';

import AwsNode from './nodes/AwsNode';
import ModuleConfigPanel from './panels/ModuleConfigPanel';

const nodeTypes = { awsNode: AwsNode };

/* ---------------------------------- */
/* Types                              */
/* ---------------------------------- */

type RegistryModule = {
  id: string;
  name: string;
  system: string;
  version: string; // usually "1.0.0"
  kind: 'leaf' | 'composite';
  categories?: string[];
};

type RegistryTree = {
  [system: string]: {
    [category: string]: RegistryModule[];
  };
};

type ModuleSchema = {
  inputs?: Array<any>;
  outputs?: Array<any>;
};

type NodeModuleRef = RegistryModule & {
  // populated from registry/version response
  module_path?: string; // e.g. "modules/aws/ec2/instance"
  git_url?: string;     // e.g. "git::https://github.com/...//modules/aws/ec2/instance?ref=SHA"
  schema?: ModuleSchema;
};

/* ---------------------------------- */
/* Helpers                            */
/* ---------------------------------- */

function buildRegistryTree(modules: RegistryModule[]): RegistryTree {
  const tree: RegistryTree = {};

  modules.forEach((m) => {
    const system = m.system ?? 'unknown';
    const categories =
      Array.isArray(m.categories) && m.categories.length > 0
        ? m.categories
        : ['misc'];

    if (!tree[system]) tree[system] = {};

    categories.forEach((cat) => {
      if (!tree[system][cat]) tree[system][cat] = [];
      if (!tree[system][cat].some((x) => x.id === m.id)) {
        tree[system][cat].push(m);
      }
    });
  });

  return tree;
}

function stripRuntime(nodes: any[]) {
  return (nodes ?? []).map((n) => {
    const data = n?.data ?? {};
    const { __runtime, ...cleanData } = data;
    return { ...n, data: cleanData };
  });
}

// Turns config into Lace bindings { lit: value } (skips empty)
function toBindings(config: Record<string, any>) {
  const result: Record<string, any> = {};
  Object.entries(config || {}).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    result[key] = { lit: value };
  });
  return result;
}

// Parse terraform-style git:: URL into {repo, subdir, ref}
function parseTerraformGitSource(gitUrl?: string): {
  repo: string;
  subdir?: string;
  ref?: string;
} {
  if (!gitUrl) return { repo: '' };

  // Example:
  // git::https://github.com/lace-cloud/registry-tf.git//modules/aws/ec2/instance?ref=f687...
  let s = gitUrl.trim();
  if (s.startsWith('git::')) s = s.slice('git::'.length);

  // split off query (?ref=...)
  const [beforeQ, query] = s.split('?');
  const ref = query?.startsWith('ref=') ? query.slice('ref='.length) : undefined;

  // locate "//" that indicates subdir split:
  // https://...repo.git//modules/aws/...
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
/* Canvas Inner                       */
/* ---------------------------------- */

function CanvasInner() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [registryTree, setRegistryTree] = useState<RegistryTree>({});
  const [activeNode, setActiveNode] = useState<any>(null);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const nodesRef = useRef<any[]>([]);
  const edgesRef = useRef<any[]>([]);
  const pending = useRef<Record<number, string>>({});

  /* ---------- helpers ---------- */

  const markDirty = () =>
    window.vscode.postMessage({ command: 'markDirty' });

  const attachRuntimeHandlers = (inputNodes: any[]) =>
    (inputNodes ?? []).map((n) => ({
      ...n,
      data: {
        ...(n.data ?? {}),
        __runtime: {
          onDirty: () => markDirty(),
          onOpenConfig: (id: string) => {
            const found = nodesRef.current.find((x) => x.id === id);
            setActiveNode(found ?? null);
          },
        },
      },
    }));

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  /* ---------- build bundle ---------- */

  function buildBundle(nodesInput: any[]) {
    const canvasNodes = (nodesInput ?? []).filter((n) => n?.data?.moduleRef);
    if (canvasNodes.length === 0) return null;

    const modules: Record<string, any> = {};

    // leaf module defs
    for (const node of canvasNodes) {
      const ref: NodeModuleRef = node.data.moduleRef;

      const moduleId = ref.module_path || ref.name; // prefer module_path
      const version = ref.version?.startsWith('v') ? ref.version : `v${ref.version || '1.0.0'}`;
      const leafKey = `${moduleId}@${version}`;

      const schema: ModuleSchema | undefined = ref.schema || node.data.schema;
      const inputs = schema?.inputs ?? [];
      const outputs = schema?.outputs ?? [];

      const { repo, subdir, ref: gitRef } = parseTerraformGitSource(ref.git_url);

      modules[leafKey] = {
        schema_version: '1.0',
        kind: 'module_def',
        id: moduleId,
        version,
        interface: {
          inputs,
          outputs,
        },
        impl: {
          kind: 'leaf',
          source: {
            kind: 'git',
            repo,
            subdir: subdir || ref.module_path,
            // prefer a clean semver tag when available; otherwise fall back to git sha ref
            ref: version, // keep "v1.0.0" like your desired example
            ...(gitRef ? { commit_sha: gitRef } : {}),
          },
        },
      };
    }

    // composite wrapper (entry)
    const compositeId = `deploy-${Date.now()}`;
    const compositeVersion = 'v1.0.0';
    const compositeKey = `${compositeId}@${compositeVersion}`;

    // outputs export:
    // - if only 1 node => keep output name (role_arn)
    // - if multiple nodes => prefix using node id to avoid collisions
    const exportOutputs: Record<string, any> = {};
    const compositeInterfaceOutputs: any[] = [];

    const isSingle = canvasNodes.length === 1;

    for (const node of canvasNodes) {
      const ref: NodeModuleRef = node.data.moduleRef;
      const schema: ModuleSchema | undefined = ref.schema || node.data.schema;
      const outs = schema?.outputs ?? [];

      for (const out of outs) {
        const outName = out?.name;
        if (!outName) continue;

        const exportedName = isSingle
          ? outName
          : `${sanitizeOutputName(node.id)}__${sanitizeOutputName(outName)}`;

        compositeInterfaceOutputs.push({
          name: exportedName,
          type: out?.type || 'any',
          ...(out?.description ? { description: out.description } : {}),
        });

        exportOutputs[exportedName] = {
          out: {
            module: node.id,
            name: outName,
          },
        };
      }
    }

    modules[compositeKey] = {
      schema_version: '1.0',
      kind: 'module_def',
      id: compositeId,
      version: compositeVersion,
      interface: {
        inputs: [],
        outputs: compositeInterfaceOutputs,
      },
      impl: {
        kind: 'composite',
        graph: {
          instances: canvasNodes.map((node) => {
            const ref: NodeModuleRef = node.data.moduleRef;
            const moduleId = ref.module_path || ref.name;
            const version = ref.version?.startsWith('v') ? ref.version : `v${ref.version || '1.0.0'}`;

            return {
              id: node.id, // instance id must be stable (your node id)
              use: {
                module_id: moduleId,
                version,
              },
              inputs: toBindings(node.data.config || {}),
            };
          }),
          wires: [],
          exports: {
            outputs: exportOutputs,
          },
        },
      },
    };

    return {
      schema_version: '1.0',
      kind: 'module_bundle',
      entry: {
        module_id: compositeId,
        version: compositeVersion,
      },
      modules,
    };
  }

  /* ---------- message handler ---------- */

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const m = e.data;

      if (m.command === 'loadState') {
        setNodes(attachRuntimeHandlers(m.state?.nodes ?? []));
        setEdges(m.state?.edges ?? []);
      }

      if (m.command === 'registryList') {
        const modulesArray: RegistryModule[] = Array.isArray(m.modules)
          ? m.modules
          : Object.values(m.modules ?? {}).flat();

        setRegistryTree(buildRegistryTree(modulesArray));
      }

      if (m.command === 'setRegistrySystem') {
        window.vscode.postMessage({
          command: 'requestRegistryModules',
          system: m.system,
        });
      }

      if (m.command === 'triggerSave') {
        window.vscode.postMessage({
          command: 'saveState',
          state: {
            nodes: stripRuntime(nodesRef.current),
            edges: edgesRef.current,
          },
        });
      }

      // 🔥 generate button: extension tells webview to build + send bundle
      if (m.command === 'triggerGenerate') {
        const bundle = buildBundle(nodesRef.current);
        if (!bundle) return;

        window.vscode.postMessage({
          command: 'generateBundle',
          bundle,
        });
      }

      if (m.command === 'generateSuccess') {
        setStatusMessage('Successfully generated');
        setTimeout(() => setStatusMessage(null), 3000);
      }

      // ✅ IMPORTANT: store registry/version response into the node (module_path, git_url, schema)
      if (m.command === 'moduleVersionData') {
        const id = pending.current[m.requestId];
        if (!id) return;

        const schemaFromServer = m.data?.schema;
        const modulePath = m.data?.module_path; // e.g. "modules/aws/ec2/instance"
        const gitUrl = m.data?.git_url;         // e.g. git::https://...//modules/aws/...

        setNodes((curr) =>
          attachRuntimeHandlers(
            curr.map((x) =>
              x.id === id
                ? {
                    ...x,
                    data: {
                      ...(x.data ?? {}),
                      schema: schemaFromServer,
                      moduleRef: {
                        ...(x.data?.moduleRef ?? {}),
                        module_path: modulePath,
                        git_url: gitUrl,
                        schema: schemaFromServer,
                      },
                    },
                  }
                : x
            )
          )
        );
      }
    };

    window.addEventListener('message', handler);
    window.vscode.postMessage({ command: 'webviewReady' });

    return () => window.removeEventListener('message', handler);
  }, []);

  /* ---------- drag / drop ---------- */

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();

    const raw = e.dataTransfer.getData('application/reactflow');
    if (!raw) return;

    const mod: RegistryModule = JSON.parse(raw);
    if (mod.kind !== 'leaf') return;

    const id = `${mod.system}-${mod.name}-${Date.now()}`;

    setNodes((curr) =>
      attachRuntimeHandlers([
        ...curr,
        {
          id,
          type: 'awsNode',
          position: {
            x: e.clientX - 320,
            y: e.clientY - 120,
          },
          data: {
            label: mod.name,
            moduleRef: mod as NodeModuleRef, // partial now, enriched after registry/version
          },
        },
      ])
    );

    const reqId = Date.now();
    pending.current[reqId] = id;

    window.vscode.postMessage({
      command: 'fetchModuleVersion',
      requestId: reqId,
      name: mod.name,
      system: mod.system,
      version: mod.version,
    });

    markDirty();
  };

  /* ---------------------------------- */
  /* Render                             */
  /* ---------------------------------- */

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* ---------- REGISTRY SIDEBAR ---------- */}
      <div
        style={{
          width: 300,
          padding: 8,
          borderRight: '1px solid #333',
          overflowY: 'auto',
        }}
      >
        {Object.keys(registryTree).length === 0 && (
          <div style={{ opacity: 0.6 }}>No modules available</div>
        )}

        {Object.entries(registryTree).map(([system, categories]) => (
          <div key={system} style={{ marginBottom: 14 }}>
            <div
              style={{
                fontWeight: 'bold',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              {system}
            </div>

            {Object.entries(categories).map(([category, modules]) => (
              <details key={category} open style={{ marginLeft: 8 }}>
                <summary style={{ cursor: 'pointer' }}>{category}</summary>

                {modules.map((m) => (
                  <div
                    key={m.id}
                    draggable={m.kind === 'leaf'}
                    onDragStart={(e) =>
                      e.dataTransfer.setData(
                        'application/reactflow',
                        JSON.stringify(m)
                      )
                    }
                    style={{
                      marginLeft: 20,
                      padding: '4px 6px',
                      cursor: 'grab',
                    }}
                  >
                    📦 {m.name}{' '}
                    <span style={{ opacity: 0.6 }}>v{m.version}</span>
                  </div>
                ))}
              </details>
            ))}
          </div>
        ))}
      </div>

      {/* ---------- CANVAS ---------- */}
      <div
        style={{ flex: 1, position: 'relative' }}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {statusMessage && (
          <div
            style={{
              position: 'absolute',
              top: 44,
              left: 16,
              zIndex: 20,
              background: '#1f6feb',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 12,
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }}
          >
            {statusMessage}
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={(changes) =>
            setNodes((curr) =>
              attachRuntimeHandlers(applyNodeChanges(changes, curr))
            )
          }
          onEdgesChange={(changes) =>
            setEdges((curr) => applyEdgeChanges(changes, curr))
          }
        >
          <Background />
          <Controls />
        </ReactFlow>

        {activeNode && activeNode.data?.schema && (
          <ModuleConfigPanel
            title={activeNode.data.label}
            inputs={activeNode.data.schema.inputs}
            outputs={activeNode.data.schema.outputs ?? []}
            initialValues={activeNode.data.config ?? {}}
            onSave={(v: any) => {
              setNodes((curr) =>
                attachRuntimeHandlers(
                  curr.map((x) =>
                    x.id === activeNode.id
                      ? { ...x, data: { ...x.data, config: v } }
                      : x
                  )
                )
              );
              setActiveNode(null);
              markDirty();
            }}
            onClose={() => setActiveNode(null)}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- */
/* Export                             */
/* ---------------------------------- */

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
