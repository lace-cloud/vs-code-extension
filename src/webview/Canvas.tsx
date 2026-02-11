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
  version: string;
  kind: 'leaf' | 'composite';
  categories?: string[];
};

type RegistryTree = {
  [system: string]: {
    [category: string]: RegistryModule[];
  };
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

/**
 * IMPORTANT:
 * - Never persist functions inside node.data (structured clone will fail)
 * - We attach runtime-only handlers under data.__runtime
 * - Before saving, we strip data.__runtime
 */
function stripRuntime(nodes: any[]) {
  return (nodes ?? []).map((n) => {
    const data = n?.data ?? {};
    const { __runtime, ...cleanData } = data;
    return { ...n, data: cleanData };
  });
}

/* ---------------------------------- */
/* Canvas Inner                       */
/* ---------------------------------- */

function CanvasInner() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [registryTree, setRegistryTree] = useState<RegistryTree>({});
  const [activeNode, setActiveNode] = useState<any>(null);

  const nodesRef = useRef<any[]>([]);
  const edgesRef = useRef<any[]>([]);
  const pending = useRef<Record<number, string>>({});

  /* ---------- helpers ---------- */

  const markDirty = () =>
    window.vscode.postMessage({ command: 'markDirty' });

  /**
   * Attach non-serializable handlers in a dedicated runtime namespace.
   * This keeps persisted state JSON-safe.
   */
  const attachRuntimeHandlers = (inputNodes: any[]) =>
    (inputNodes ?? []).map((n) => ({
      ...n,
      data: {
        ...(n.data ?? {}),
        __runtime: {
          onDirty: () => markDirty(),
          onOpenConfig: (id: string) => {
            // Use refs (latest nodes), not stale closure
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
        window.vscode.postMessage({
          command: 'requestRegistryModules',
          system: m.system,
        });
      }

      if (m.command === 'triggerSave') {
        // 🔥 strip runtime functions before posting to extension
        window.vscode.postMessage({
          command: 'saveState',
          state: {
            nodes: stripRuntime(nodesRef.current),
            edges: edgesRef.current,
          },
        });
      }

      if (m.command === 'moduleVersionData') {
        const id = pending.current[m.requestId];
        if (!id) return;

        setNodes((curr) =>
          attachRuntimeHandlers(
            curr.map((x) =>
              x.id === id
                ? {
                    ...x,
                    data: { ...(x.data ?? {}), schema: m.data?.schema },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            moduleRef: mod,
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
                    onDragStart={(e) => {
                      if (m.kind !== 'leaf') return;

                      e.dataTransfer.setData(
                        'application/reactflow',
                        JSON.stringify({
                          id: m.id,
                          name: m.name,
                          system: m.system,
                          version: m.version,
                          kind: m.kind,
                        })
                      );
                    }}
                    style={{
                      marginLeft: 20,
                      padding: '4px 6px',
                      cursor: m.kind === 'leaf' ? 'grab' : 'default',
                      opacity: m.kind === 'leaf' ? 1 : 0.5,
                      userSelect: 'none',
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
      <div style={{ flex: 1 }} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={(changes) =>
            setNodes((curr) => attachRuntimeHandlers(applyNodeChanges(changes, curr)))
          }
          onEdgesChange={(changes) =>
            setEdges((curr) => applyEdgeChanges(changes, curr))
          }
        >
          <Background />
          <Controls />
        </ReactFlow>

        {activeNode && (
          <ModuleConfigPanel
            title={activeNode.data?.label}
            inputs={activeNode.data?.schema?.inputs ?? []}
            initialValues={activeNode.data?.config ?? {}}
            onSave={(v: any) => {
              setNodes((curr) =>
                attachRuntimeHandlers(
                  curr.map((x) =>
                    x.id === activeNode.id
                      ? {
                          ...x,
                          data: { ...(x.data ?? {}), config: v },
                        }
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
