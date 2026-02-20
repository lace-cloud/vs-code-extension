// src/webview/components/Canvas.tsx
import React, { useEffect, useState, useRef } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Background,
  Controls,
  Connection,
  Edge,
} from 'react-flow-renderer';

import AwsNode from './components/nodes/AwsNode';
import ModuleConfigPanel from './components/panels/ModuleConfigPanel';
import EdgeConfigPanel from './components/panels/EdgeConfigPanel';
import RegistrySidebar, {
  RegistryModule,
  RegistryTree,
} from './components/sidebars/RegistrySidebar';
import graphToJson from './utils/graphToJson';
import jsonToGraph from './utils/jsonToGraph';

const nodeTypes = { awsNode: AwsNode };

/* ---------------------------------- */
/* Helpers                            */
/* ---------------------------------- */

function buildRegistryTree(modules: RegistryModule[]): RegistryTree {
  const tree: RegistryTree = {};

  modules.forEach((m) => {
    const system = m.system ?? 'unknown';
    const categories =
      Array.isArray(m.categories) && m.categories.length > 0 ? m.categories : ['misc'];

    if (!tree[system]) tree[system] = {};

    categories.forEach((cat) => {
      if (!tree[system][cat]) tree[system][cat] = [];
      if (!tree[system][cat].some((x) => x.id === m.id)) tree[system][cat].push(m);
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

// Terraform identifier rules-ish: [a-zA-Z_][a-zA-Z0-9_-]* (we'll normalize to _)
function toTerraformModuleName(id: string) {
  const base = (id || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '_');
  if (!base) return 'module_x';
  if (/^[a-zA-Z_]/.test(base)) return base;
  return `m_${base}`;
}

/* ---------------------------------- */
/* Canvas Inner                       */
/* ---------------------------------- */

function CanvasInner() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<Edge<any>[]>([]);
  const [registryTree, setRegistryTree] = useState<RegistryTree>({});
  const [activeNode, setActiveNode] = useState<any>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // ✅ Edge config UI state
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const nodesRef = useRef<any[]>([]);
  const edgesRef = useRef<Edge<any>[]>([]);
  const pending = useRef<Record<number, string>>({});
  const pendingComposite = useRef<
    Record<number, { dropPosition: { x: number; y: number }; system: string }>
  >({});

  /* ---------- helpers ---------- */

  const markDirty = () => window.vscode.postMessage({ command: 'markDirty' });

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

  /* ---------------------------------- */
  /* Delete Edge with Keyboard         */
  /* ---------------------------------- */

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedEdgeId) {
        setEdges((curr) => curr.filter((edge) => edge.id !== selectedEdgeId));
        setSelectedEdgeId(null);
        markDirty();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEdgeId]);

  /* ---------------------------------- */
  /* Edge connect + config panel        */
  /* ---------------------------------- */

  const onConnect = (conn: Connection) => {
    if (!conn.source || !conn.target) return;

    const edgeId = `e-${conn.source}-${conn.target}-${Date.now()}`;

    const newEdge: Edge<any> = {
      id: edgeId,
      source: conn.source,
      target: conn.target,
      sourceHandle: conn.sourceHandle,
      targetHandle: conn.targetHandle,
      type: 'default',
      animated: false,
      data: {},
    };

    setEdges((eds) => addEdge(newEdge, eds));
    setActiveEdgeId(edgeId);
    markDirty();
  };

  const onEdgeClick = (_: any, edge: Edge<any>) => {
    setSelectedEdgeId(edge.id);
  };

  const onEdgeDoubleClick = (_: any, edge: Edge<any>) => {
    setActiveEdgeId(edge.id);
  };

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
        const tree = buildRegistryTree(modulesArray);
        setRegistryTree(tree);
      }

      if (m.command === 'setRegistrySystem') {
        window.vscode.postMessage({ command: 'requestRegistryModules', system: m.system });
      }

      if (m.command === 'triggerSave') {
        window.vscode.postMessage({
          command: 'saveState',
          state: { nodes: stripRuntime(nodesRef.current), edges: edgesRef.current },
        });
      }

      if (m.command === 'triggerGenerate') {
        const bundle = graphToJson(nodesRef.current, edgesRef.current);
        if (!bundle) return;
        window.vscode.postMessage({ command: 'generateBundle', bundle });
      }

      if (m.command === 'generateSuccess') {
        setStatusMessage('Successfully generated');
        setTimeout(() => setStatusMessage(null), 3000);
      }

      if (m.command === 'moduleVersionData') {
        // ── Composite expansion ──
        const compositeCtx = pendingComposite.current[m.requestId];
        if (compositeCtx) {
          delete pendingComposite.current[m.requestId];

          if (m.data?.kind === 'composite' && m.data?.bundle) {
            const result = jsonToGraph(m.data, compositeCtx.dropPosition);

            // Add all expanded nodes + edges to the canvas
            setNodes((curr) => attachRuntimeHandlers([...curr, ...result.nodes]));
            setEdges((curr) => [...curr, ...result.edges]);

            markDirty();
          }
          return;
        }

        // ── Leaf node update ──
        const id = pending.current[m.requestId];
        if (!id) return;

        const schemaFromServer = m.data?.schema;
        const modulePath = m.data?.module_path;
        const gitUrl = m.data?.git_url;

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
                : x,
            ),
          ),
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
    if (mod.kind !== 'leaf') {
      const reqId = Date.now();
      pendingComposite.current[reqId] = {
        dropPosition: { x: e.clientX - 320, y: e.clientY - 120 },
        system: mod.system,
      };
      window.vscode.postMessage({
        command: 'fetchModuleVersion',
        requestId: reqId,
        name: mod.name,
        system: mod.system,
        version: mod.version,
      });
      return;
    }

    const id = `${mod.system}-${mod.name}-${Date.now()}`;

    setNodes((curr) =>
      attachRuntimeHandlers([
        ...curr,
        {
          id,
          type: 'awsNode',
          position: { x: e.clientX - 320, y: e.clientY - 120 },
          data: { label: mod.name, moduleRef: mod },
        },
      ]),
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

  /* ---------- Edge Panel helpers ---------- */

  const activeEdge = activeEdgeId ? edges.find((e) => e.id === activeEdgeId) : undefined;
  const fromNode = activeEdge ? nodes.find((n) => n.id === activeEdge.source) : undefined;
  const toNode = activeEdge ? nodes.find((n) => n.id === activeEdge.target) : undefined;

  const fromOutputs = (fromNode?.data?.schema?.outputs ?? []) as any[];
  const toInputs = (toNode?.data?.schema?.inputs ?? []) as any[];

  /* ---------------------------------- */
  /* Render                             */
  /* ---------------------------------- */

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* registry sidebar */}
      <RegistrySidebar registryTree={registryTree} />

      {/* canvas */}
      <div
        style={{ flex: 1, position: 'relative' }}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {statusMessage && (
          <div className="absolute top-11 left-4 z-20 bg-[#1f6feb] text-white px-3 py-1.5 rounded-md text-xs shadow-[0_2px_6px_rgba(0,0,0,0.3)]">
            {statusMessage}
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges.map((e) => {
            const mapping = (e.data as any)?.mapping as { from?: string; to?: string } | undefined;
            const hasLabel = Boolean(mapping?.from && mapping?.to);

            return {
              ...e,
              animated: selectedEdgeId === e.id,
              style: {
                stroke: selectedEdgeId === e.id ? '#1f6feb' : '#888',
                strokeWidth: selectedEdgeId === e.id ? 3 : 2,
              },

              // ✅ label shown without the ugly white background box
              label: hasLabel ? `${mapping!.from} → ${mapping!.to}` : undefined,
              labelStyle: { fill: '#fff', fontSize: 10 },
              labelBgPadding: [0, 0],
              labelBgBorderRadius: 0,
              labelBgStyle: { fill: 'transparent' },
            };
          })}
          nodeTypes={nodeTypes}
          onConnect={onConnect}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onEdgeClick={onEdgeClick}
          onNodesChange={(changes) =>
            setNodes((curr) => attachRuntimeHandlers(applyNodeChanges(changes, curr)))
          }
          onEdgesChange={(changes) => setEdges((curr) => applyEdgeChanges(changes, curr))}
        >
          <Background />
          <Controls />
        </ReactFlow>

        {/* Node config panel */}
        {activeNode && activeNode.data?.schema && (
          <ModuleConfigPanel
            title={activeNode.data.label}
            inputs={activeNode.data.schema.inputs}
            outputs={activeNode.data.schema.outputs ?? []}
            initialValues={activeNode.data.config ?? {}}
            wiredInputs={activeNode.data.wiredInputs ?? {}}
            onSave={(v: any) => {
              setNodes((curr) =>
                attachRuntimeHandlers(
                  curr.map((x) =>
                    x.id === activeNode.id ? { ...x, data: { ...x.data, config: v } } : x,
                  ),
                ),
              );
              setActiveNode(null);
              markDirty();
            }}
            onClose={() => setActiveNode(null)}
          />
        )}

        {/* Edge mapping panel */}
        {activeEdge && fromNode && toNode && (
          <EdgeConfigPanel
            title="Connection"
            fromLabel={fromNode.data?.label ?? fromNode.id}
            toLabel={toNode.data?.label ?? toNode.id}
            fromOutputs={fromOutputs}
            toInputs={toInputs}
            initial={(activeEdge.data as any)?.mapping}
            onClose={() => setActiveEdgeId(null)}
            onSave={(mapping) => {
              // update edge mapping
              setEdges((curr) =>
                curr.map((e) =>
                  e.id === activeEdge.id
                    ? {
                        ...e,
                        data: {
                          ...(e.data ?? {}),
                          mapping,
                        },
                      }
                    : e,
                ),
              );

              // ✅ update target node UI (wiredInputs) with Terraform-like reference:
              // module.<module_name>.<output_name>
              const tfModuleName = toTerraformModuleName(activeEdge.source);
              const tfExpr = `module.${tfModuleName}.${mapping.from}`;

              setNodes((curr) =>
                attachRuntimeHandlers(
                  curr.map((n) => {
                    if (n.id !== activeEdge.target) return n;

                    const wiredInputs = {
                      ...(n.data?.wiredInputs ?? {}),
                      [mapping.to]: tfExpr,
                    };

                    return {
                      ...n,
                      data: {
                        ...n.data,
                        wiredInputs,
                      },
                    };
                  }),
                ),
              );

              setActiveEdgeId(null);
              markDirty();
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
