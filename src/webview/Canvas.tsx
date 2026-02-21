// src/webview/Canvas.tsx
import React, { useEffect, useState, useReducer, useMemo, useCallback, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from 'reactflow';

import ModuleNode from './components/nodes/ModuleNode';
import { ErrorState } from './components/ErrorBoundary';
import ModuleConfigPanel from './components/panels/ModuleConfigPanel';
import EdgeConfigPanel from './components/panels/EdgeConfigPanel';
import RegistrySidebar, {
  type RegistryModule,
  type RegistryTree,
} from './components/sidebars/RegistrySidebar';

import type { WorkspaceState } from './types/workspace';
import type { ModuleBundle } from './types/ir';
import { isOut } from './types/ir';
import type { WebviewToHost } from '../types/protocol';

import { workspaceReducer, type WorkspaceAction } from './state/reducer';
import { CanvasContext, type CanvasCallbacks } from './state/context';
import { deriveEdges } from './utils/derive';
import { resolveSchema, resolveNodeType } from './utils/resolve';
import { toBundle, fromBundle } from './utils/bundle';
import { toTerraformIdentifier } from './utils/identifiers';

// ── Node types registration ──

const nodeTypes = {
  moduleNode: ModuleNode,
  compositeNode: ModuleNode,
};

// ── Helper: post typed message to host ──

function postToHost(msg: WebviewToHost) {
  window.vscode.postMessage(msg);
}

// ── Helper: build registry tree from flat module list ──

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

// ── Initial empty workspace ──

function emptyWorkspace(name: string): WorkspaceState {
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

// ══════════════════════════════════════════════════════════════════════
// Canvas Component
// ══════════════════════════════════════════════════════════════════════

export default function Canvas() {
  const [workspace, dispatch] = useReducer(workspaceReducer, emptyWorkspace('untitled'));
  const [registryTree, setRegistryTree] = useState<RegistryTree>({});
  const [configTarget, setConfigTarget] = useState<string | null>(null);
  const [edgeConfigState, setEdgeConfigState] = useState<{
    source: string;
    target: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Pending drop requests: requestId → drop position
  const pendingDrops = useRef<Record<number, { x: number; y: number }>>({});

  // Local position tracking (ReactFlow owns position during drag)
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>(
    {},
  );

  // ── Active module key ──
  const module_key = `${workspace.entry.module_id}@${workspace.entry.version}`;
  const rootDef = workspace.modules[module_key];

  // Stable ref for workspace (used in message handler to avoid stale closure)
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const moduleKeyRef = useRef(module_key);
  moduleKeyRef.current = module_key;

  // ── Semantic dispatch wrapper ──
  const semanticDispatch = useCallback((action: WorkspaceAction) => {
    dispatch(action);
    if (action.type !== 'LOAD_WORKSPACE' && action.type !== 'SYNC_LAYOUT') {
      postToHost({ command: 'markDirty' });
    }
  }, []);

  // ── Expose dispatch globally for ModuleNode rename/delete ──
  useEffect(() => {
    (window as any).__canvasDispatch = semanticDispatch;
    (window as any).__activeModuleKey = module_key;
    return () => {
      delete (window as any).__canvasDispatch;
      delete (window as any).__activeModuleKey;
    };
  }, [semanticDispatch, module_key]);

  // ── Context callbacks for nodes ──
  const callbacks: CanvasCallbacks = useMemo(
    () => ({
      openConfig: (id) => setConfigTarget(id),
      navigateIn: () => {
        /* Phase 3 — noop */
      },
      markDirty: () => postToHost({ command: 'markDirty' }),
    }),
    [],
  );

  // ── Guard: root must be composite ──
  if (!rootDef || rootDef.impl.kind !== 'composite') {
    return <ErrorState message={`Root module "${module_key}" is not a composite.`} />;
  }

  const graph = rootDef.impl.graph;
  const layout = workspace.layouts[module_key];

  // ── Derive ReactFlow nodes ──
  const rfNodes: Node[] = useMemo(
    () =>
      graph.instances.map((inst) => ({
        id: inst.id,
        type: resolveNodeType(workspace, inst),
        position: localPositions[inst.id] ?? layout?.nodes[inst.id]?.position ?? { x: 0, y: 0 },
        data: { instance: inst, schema: resolveSchema(workspace, inst) },
      })),
    [graph.instances, layout, workspace, localPositions],
  );

  // ── Derive ReactFlow edges ──
  const rfEdges: Edge[] = useMemo(
    () =>
      deriveEdges(graph.instances).map((e) => ({
        id: `${e.source_instance}:${e.mapping.from}-${e.target_instance}:${e.mapping.to}`,
        source: e.source_instance,
        target: e.target_instance,
        data: { mapping: e.mapping },
        label: `${e.mapping.from} → ${e.mapping.to}`,
        labelStyle: { fill: '#fff', fontSize: 10 },
        labelBgPadding: [0, 0] as [number, number],
        labelBgBorderRadius: 0,
        labelBgStyle: { fill: 'transparent' },
      })),
    [graph.instances],
  );

  // ── Event: node position changes during drag ──
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const posUpdates: Record<string, { x: number; y: number }> = {};
    for (const change of changes) {
      if (change.type === 'position' && change.position && change.id) {
        posUpdates[change.id] = change.position;
      }
    }
    if (Object.keys(posUpdates).length > 0) {
      setLocalPositions((prev) => ({ ...prev, ...posUpdates }));
    }
  }, []);

  // ── Event: node drag stop → sync layout to workspace ──
  const onNodeDragStop = useCallback((_event: React.MouseEvent, _node: Node, nodes: Node[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) {
      positions[n.id] = n.position;
    }
    dispatch({
      type: 'SYNC_LAYOUT',
      module_key: moduleKeyRef.current,
      positions,
    });
  }, []);

  // ── Event: new connection ──
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;

      const ws = workspaceRef.current;
      const mk = moduleKeyRef.current;
      const def = ws.modules[mk];
      if (!def || def.impl.kind !== 'composite') return;

      const instances = def.impl.graph.instances;
      const sourceInst = instances.find((i) => i.id === conn.source);
      const targetInst = instances.find((i) => i.id === conn.target);
      if (!sourceInst || !targetInst) return;

      const sourceSchema = resolveSchema(ws, sourceInst);
      const targetSchema = resolveSchema(ws, targetInst);

      // Find unbound target inputs
      const unboundInputs = targetSchema.inputs.filter((inp) => {
        const binding = targetInst.inputs[inp.name];
        return !binding || !isOut(binding);
      });

      // Auto-connect if exactly one output and one unbound input
      if (sourceSchema.outputs.length === 1 && unboundInputs.length === 1) {
        semanticDispatch({
          type: 'CONNECT',
          module_key: mk,
          source_instance: conn.source,
          target_instance: conn.target,
          mapping: {
            from: sourceSchema.outputs[0].name,
            to: unboundInputs[0].name,
          },
        });
      } else {
        setEdgeConfigState({
          source: conn.source,
          target: conn.target,
        });
      }
    },
    [semanticDispatch],
  );

  // ── Event: drop from registry sidebar ──
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/lace-module');
    if (!raw) return;

    const mod: RegistryModule = JSON.parse(raw);
    const requestId = Date.now();

    pendingDrops.current[requestId] = {
      x: e.clientX - 320,
      y: e.clientY - 120,
    };

    postToHost({
      command: 'fetchModuleVersion',
      requestId,
      name: mod.name,
      system: mod.system,
      version: mod.version,
    });
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // ── Message handler: host → webview ──
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;

      switch (msg.command) {
        case 'loadState': {
          dispatch({ type: 'LOAD_WORKSPACE', workspace: msg.state });
          setLocalPositions({});
          break;
        }

        case 'registryList': {
          const modulesArray: RegistryModule[] = Array.isArray(msg.modules)
            ? msg.modules
            : Object.values(msg.modules ?? {}).flat();
          setRegistryTree(buildRegistryTree(modulesArray));
          break;
        }

        case 'setRegistrySystem': {
          postToHost({ command: 'requestRegistryModules', system: msg.system });
          break;
        }

        case 'triggerSave': {
          postToHost({ command: 'saveState', state: workspaceRef.current });
          break;
        }

        case 'triggerGenerate': {
          const bundle = toBundle(workspaceRef.current);
          postToHost({ command: 'generateBundle', bundle });
          break;
        }

        case 'generateSuccess': {
          setStatusMessage('Successfully generated');
          setTimeout(() => setStatusMessage(null), 3000);
          break;
        }

        case 'generateError': {
          setStatusMessage(`Generate error: ${msg.message}`);
          setTimeout(() => setStatusMessage(null), 5000);
          break;
        }

        case 'dropBundle': {
          const dropPos = pendingDrops.current[msg.requestId];
          delete pendingDrops.current[msg.requestId];

          const deployBundle: ModuleBundle = msg.deploy_bundle;
          if (!deployBundle) break;

          // Parse through fromBundle to normalize bindings
          const { workspace: parsed, errors } = fromBundle(deployBundle);
          if (errors.length > 0) {
            console.warn('Deploy bundle parse errors:', errors);
          }

          // Build positions map for entry composite's instances
          const entryKey = `${deployBundle.entry.module_id}@${deployBundle.entry.version}`;
          const entryDef = parsed.modules[entryKey];
          const positions: Record<string, { x: number; y: number }> = {};

          if (entryDef?.impl.kind === 'composite') {
            const instances = entryDef.impl.graph.instances;
            const basePos = dropPos ?? { x: 100, y: 100 };
            const cols = Math.max(2, Math.ceil(Math.sqrt(instances.length)));

            for (let i = 0; i < instances.length; i++) {
              const col = i % cols;
              const row = Math.floor(i / cols);
              positions[instances[i].id] = {
                x: basePos.x + col * 260,
                y: basePos.y + row * 180,
              };
            }
          }

          // Reconstruct as ModuleBundle (without layouts) for DROP_BUNDLE
          const bundleForDrop: ModuleBundle = {
            schema_version: parsed.schema_version,
            kind: parsed.kind,
            entry: parsed.entry,
            modules: parsed.modules,
          };

          semanticDispatch({
            type: 'DROP_BUNDLE',
            module_key: moduleKeyRef.current,
            deploy_bundle: bundleForDrop,
            positions,
          });
          break;
        }

        case 'rpcError': {
          if (msg.requestId) {
            delete pendingDrops.current[msg.requestId];
          }
          setStatusMessage(`Error: ${msg.message}`);
          setTimeout(() => setStatusMessage(null), 5000);
          break;
        }
      }
    };

    window.addEventListener('message', handler);
    postToHost({ command: 'webviewReady' });

    return () => {
      window.removeEventListener('message', handler);
    };
  }, [semanticDispatch]);

  // ── Config panel target data ──
  const configInstance = configTarget
    ? graph.instances.find((i) => i.id === configTarget)
    : undefined;
  const configSchema = configInstance ? resolveSchema(workspace, configInstance) : undefined;

  // ── Edge config panel data ──
  const edgeSourceInst = edgeConfigState
    ? graph.instances.find((i) => i.id === edgeConfigState.source)
    : undefined;
  const edgeTargetInst = edgeConfigState
    ? graph.instances.find((i) => i.id === edgeConfigState.target)
    : undefined;

  // ── Render ──
  return (
    <CanvasContext.Provider value={callbacks}>
      <div className="flex h-screen">
        {/* Registry sidebar */}
        <RegistrySidebar registryTree={registryTree} />

        {/* Canvas area */}
        <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
          {statusMessage && (
            <div className="absolute top-11 left-4 z-20 bg-[#1f6feb] text-white px-3 py-1.5 rounded-md text-xs shadow-[0_2px_6px_rgba(0,0,0,0.3)]">
              {statusMessage}
            </div>
          )}

          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>

          {/* Module config panel */}
          {configTarget && configInstance && configSchema && (
            <ModuleConfigPanel
              instance_id={configTarget}
              schema={configSchema}
              inputs={configInstance.inputs}
              onSave={(inputs) => {
                semanticDispatch({
                  type: 'UPDATE_INPUTS',
                  module_key,
                  instance_id: configTarget,
                  inputs,
                });
                setConfigTarget(null);
              }}
              onClose={() => setConfigTarget(null)}
            />
          )}

          {/* Edge config panel */}
          {edgeConfigState && edgeSourceInst && edgeTargetInst && (
            <EdgeConfigPanel
              source_instance={edgeConfigState.source}
              target_instance={edgeConfigState.target}
              source_schema={resolveSchema(workspace, edgeSourceInst)}
              target_schema={resolveSchema(workspace, edgeTargetInst)}
              target_inputs={edgeTargetInst.inputs}
              onConnect={(mapping) => {
                semanticDispatch({
                  type: 'CONNECT',
                  module_key,
                  source_instance: edgeConfigState.source,
                  target_instance: edgeConfigState.target,
                  mapping,
                });
                setEdgeConfigState(null);
              }}
              onClose={() => setEdgeConfigState(null)}
            />
          )}
        </div>
      </div>
    </CanvasContext.Provider>
  );
}
