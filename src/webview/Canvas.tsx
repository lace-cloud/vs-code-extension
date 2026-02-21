// src/webview/Canvas.tsx
import React, { useEffect, useState, useReducer, useMemo, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';

import ModuleNode from './components/nodes/ModuleNode';
import CompositeNode from './components/nodes/CompositeNode';
import { ErrorState } from './components/ErrorBoundary';
import ModuleConfigPanel from './components/panels/ModuleConfigPanel';
import EdgeConfigPanel from './components/panels/EdgeConfigPanel';
import VariablesPanel from './components/panels/VariablesPanel';
import OutputsPanel from './components/panels/OutputsPanel';
import TerraformConfigPanel from './components/panels/TerraformConfigPanel';
import ProvidersPanel from './components/panels/ProvidersPanel';
import LocalsPanel from './components/panels/LocalsPanel';
import EnvironmentsPanel from './components/panels/EnvironmentsPanel';
import Breadcrumb from './components/Breadcrumb';

import type { WorkspaceState, GraphLayout } from './types/workspace';
import type { ModuleBundle, CompositeGraph } from './types/ir';
import { isOut, isModuleInstance } from './types/ir';
import type { WebviewToHost } from '../types/protocol';

import { workspaceReducer, type WorkspaceAction } from './state/reducer';
import { CanvasContext, type CanvasCallbacks } from './state/context';
import { deriveEdges } from './utils/derive';
import { resolveSchema, resolveNodeType } from './utils/resolve';
import { toBundle, fromBundle, emptyWorkspace } from './utils/bundle';

// ── Node types registration ──

const nodeTypes = {
  moduleNode: ModuleNode,
  compositeNode: CompositeNode,
};

// ── Helper: post typed message to host ──

function postToHost(msg: WebviewToHost) {
  window.vscode.postMessage(msg);
}

// ══════════════════════════════════════════════════════════════════════
// CompositeEditor — renders the ReactFlow viewport for a valid graph.
//
// Separated from Canvas so that its hooks (useMemo for rfNodes/rfEdges)
// only mount when a valid composite graph exists. This avoids React's
// "rendered fewer hooks" error (#300) — Canvas can safely early-return
// <ErrorState> without skipping any hooks, because the graph-dependent
// hooks live here and are never mounted in the error path.
// ══════════════════════════════════════════════════════════════════════

type CompositeEditorProps = {
  graph: CompositeGraph;
  layout: GraphLayout | undefined;
  workspace: WorkspaceState;
  module_key: string;
  validationErrors: Array<{ module_key?: string; instance_id?: string; message: string }>;
  localPositions: Record<string, { x: number; y: number }>;
  onNodesChange: (changes: NodeChange[]) => void;
  onNodeDragStop: (event: React.MouseEvent, node: Node, nodes: Node[]) => void;
  onConnect: (conn: Connection) => void;
};

function CompositeEditor({
  graph,
  layout,
  workspace,
  module_key,
  validationErrors,
  localPositions,
  onNodesChange,
  onNodeDragStop,
  onConnect,
}: CompositeEditorProps) {
  // ── Derive ReactFlow nodes ──
  const rfNodes: Node[] = useMemo(
    () =>
      graph.instances.map((inst) => {
        const nodeErrors = validationErrors.filter(
          (e) => e.instance_id === inst.id && e.module_key === module_key,
        );
        return {
          id: inst.id,
          type: resolveNodeType(workspace, inst),
          position: localPositions[inst.id] ?? layout?.nodes[inst.id]?.position ?? { x: 0, y: 0 },
          data: {
            instance: inst,
            schema: resolveSchema(workspace, inst),
            hasErrors: nodeErrors.length > 0,
            errorMessages: nodeErrors.map((e) => e.message),
          },
        };
      }),
    [graph.instances, layout, workspace, localPositions, validationErrors, module_key],
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

  return (
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
  );
}

// ══════════════════════════════════════════════════════════════════════
// Canvas — top-level component owning all workspace state.
//
// All hooks run unconditionally before the composite guard. The guard
// is a clean early return that renders <ErrorState> if the active
// module is not a composite. When the guard passes, <CompositeEditor>
// renders the ReactFlow viewport with its own memoized hooks.
// ══════════════════════════════════════════════════════════════════════

export default function Canvas() {
  const [workspace, dispatch] = useReducer(workspaceReducer, emptyWorkspace('untitled'));
  const [configTarget, setConfigTarget] = useState<string | null>(null);
  const [edgeConfigState, setEdgeConfigState] = useState<{
    source: string;
    target: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [variablesPanelOpen, setVariablesPanelOpen] = useState(false);
  const [outputsPanelOpen, setOutputsPanelOpen] = useState(false);
  const [terraformPanelOpen, setTerraformPanelOpen] = useState(false);
  const [providersPanelOpen, setProvidersPanelOpen] = useState(false);
  const [localsPanelOpen, setLocalsPanelOpen] = useState(false);
  const [environmentsPanelOpen, setEnvironmentsPanelOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    Array<{ module_key?: string; instance_id?: string; message: string }>
  >([]);

  // Local position tracking (ReactFlow owns position during drag)
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>(
    {},
  );

  // ── Breadcrumb navigation ──
  const entry_key = `${workspace.entry.module_id}@${workspace.entry.version}`;
  const [breadcrumb, setBreadcrumb] = useState<string[]>([entry_key]);

  // Reset breadcrumb when entry changes (e.g., LOAD_WORKSPACE)
  useEffect(() => {
    setBreadcrumb([entry_key]);
  }, [entry_key]);

  const active_key = breadcrumb[breadcrumb.length - 1];

  const navigateIn = useCallback(
    (instance_id: string) => {
      const ws = workspaceRef.current;
      const ak = active_key;
      const def = ws.modules[ak];
      if (!def || def.impl.kind !== 'composite') return;

      const inst = def.impl.graph.instances.find((i) => i.id === instance_id);
      if (!inst || !isModuleInstance(inst)) return;

      const targetKey = `${inst.use.module_id}@${inst.use.version}`;
      const targetDef = ws.modules[targetKey];
      if (!targetDef || targetDef.impl.kind !== 'composite') return;

      setBreadcrumb((prev) => [...prev, targetKey]);
      setLocalPositions({});
      setConfigTarget(null);
      setEdgeConfigState(null);
    },
    [active_key],
  );

  const navigateTo = useCallback((index: number) => {
    setBreadcrumb((prev) => prev.slice(0, index + 1));
    setLocalPositions({});
    setConfigTarget(null);
    setEdgeConfigState(null);
  }, []);

  // ── Active module key (breadcrumb-driven) ──
  const module_key = active_key;
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
      navigateIn,
      markDirty: () => postToHost({ command: 'markDirty' }),
    }),
    [navigateIn],
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

  // ── Message handler: host → webview ──
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;

      switch (msg.command) {
        case 'loadState': {
          dispatch({ type: 'LOAD_WORKSPACE', workspace: msg.state });
          setLocalPositions({});
          // Breadcrumb resets via the entry_key useEffect
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
            const basePos = { x: 100, y: 100 };
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

        case 'triggerVariables': {
          setVariablesPanelOpen(true);
          setOutputsPanelOpen(false);
          setTerraformPanelOpen(false);
          setProvidersPanelOpen(false);
          setLocalsPanelOpen(false);
          setEnvironmentsPanelOpen(false);
          setConfigTarget(null);
          break;
        }

        case 'triggerOutputs': {
          setOutputsPanelOpen(true);
          setVariablesPanelOpen(false);
          setTerraformPanelOpen(false);
          setProvidersPanelOpen(false);
          setLocalsPanelOpen(false);
          setEnvironmentsPanelOpen(false);
          setConfigTarget(null);
          break;
        }

        case 'triggerTerraformConfig': {
          setTerraformPanelOpen(true);
          setVariablesPanelOpen(false);
          setOutputsPanelOpen(false);
          setProvidersPanelOpen(false);
          setLocalsPanelOpen(false);
          setEnvironmentsPanelOpen(false);
          setConfigTarget(null);
          break;
        }

        case 'triggerProviders': {
          setProvidersPanelOpen(true);
          setVariablesPanelOpen(false);
          setOutputsPanelOpen(false);
          setTerraformPanelOpen(false);
          setLocalsPanelOpen(false);
          setEnvironmentsPanelOpen(false);
          setConfigTarget(null);
          break;
        }

        case 'triggerLocals': {
          setLocalsPanelOpen(true);
          setVariablesPanelOpen(false);
          setOutputsPanelOpen(false);
          setTerraformPanelOpen(false);
          setProvidersPanelOpen(false);
          setEnvironmentsPanelOpen(false);
          setConfigTarget(null);
          break;
        }

        case 'triggerEnvironments': {
          setEnvironmentsPanelOpen(true);
          setVariablesPanelOpen(false);
          setOutputsPanelOpen(false);
          setTerraformPanelOpen(false);
          setProvidersPanelOpen(false);
          setLocalsPanelOpen(false);
          setConfigTarget(null);
          break;
        }

        case 'validationErrors': {
          setValidationErrors(msg.errors ?? []);
          if (msg.errors?.length > 0) {
            setStatusMessage(`Validation: ${msg.errors.length} error(s) found`);
            setTimeout(() => setStatusMessage(null), 5000);
          }
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

  // ── Guard: active module must be composite ──
  // Clean early return — every hook above runs unconditionally.
  // Graph-dependent hooks live in CompositeEditor, which only
  // mounts when this guard passes.
  if (!rootDef || rootDef.impl.kind !== 'composite') {
    return <ErrorState message={`Root module "${module_key}" is not a composite.`} />;
  }

  const graph = rootDef.impl.graph;
  const layout = workspace.layouts[module_key];

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
      <div className="h-screen relative">
        {/* Breadcrumb navigation */}
        <Breadcrumb path={breadcrumb} onNavigate={navigateTo} />

        {statusMessage && (
          <div className="absolute top-11 left-4 z-20 bg-[#1f6feb] text-white px-3 py-1.5 rounded-md text-xs shadow-[0_2px_6px_rgba(0,0,0,0.3)]">
            {statusMessage}
          </div>
        )}

        <CompositeEditor
          graph={graph}
          layout={layout}
          workspace={workspace}
          module_key={module_key}
          validationErrors={validationErrors}
          localPositions={localPositions}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
        />

        {/* Module config panel */}
        {configTarget && configInstance && configSchema && (
          <ModuleConfigPanel
            instance_id={configTarget}
            schema={configSchema}
            inputs={configInstance.inputs}
            composite_variables={rootDef.interface.inputs}
            sibling_ids={graph.instances.map((i) => i.id).filter((id) => id !== configTarget)}
            depends_on={configInstance.depends_on}
            onSave={(inputs) => {
              semanticDispatch({
                type: 'UPDATE_INPUTS',
                module_key,
                instance_id: configTarget,
                inputs,
              });
              setConfigTarget(null);
            }}
            onSaveDependsOn={(depends_on) => {
              semanticDispatch({
                type: 'SET_DEPENDS_ON',
                module_key,
                instance_id: configTarget,
                depends_on,
              });
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

        {/* Variables panel */}
        {variablesPanelOpen && (
          <VariablesPanel
            variables={rootDef.interface.inputs}
            all_instance_inputs={Object.fromEntries(
              graph.instances.map((inst) => [inst.id, inst.inputs]),
            )}
            onSave={(variables) => {
              semanticDispatch({
                type: 'SET_VARIABLES',
                module_key,
                variables,
              });
              setVariablesPanelOpen(false);
            }}
            onClose={() => setVariablesPanelOpen(false)}
          />
        )}

        {/* Outputs panel */}
        {outputsPanelOpen && (
          <OutputsPanel
            instances={graph.instances}
            resolveInstanceSchema={(inst) => resolveSchema(workspace, inst)}
            output_defs={rootDef.interface.outputs}
            exports={graph.exports.outputs}
            onSave={(output_defs, outputs) => {
              semanticDispatch({
                type: 'SET_EXPORTS',
                module_key,
                outputs,
                output_defs,
              });
              setOutputsPanelOpen(false);
            }}
            onClose={() => setOutputsPanelOpen(false)}
          />
        )}

        {/* Terraform config panel */}
        {terraformPanelOpen && (
          <TerraformConfigPanel
            terraform={rootDef.terraform}
            onSave={(terraform) => {
              semanticDispatch({
                type: 'SET_TERRAFORM',
                module_key,
                terraform,
              });
              setTerraformPanelOpen(false);
            }}
            onClose={() => setTerraformPanelOpen(false)}
          />
        )}

        {/* Providers panel */}
        {providersPanelOpen && (
          <ProvidersPanel
            providers={rootDef.providers}
            onSave={(providers) => {
              semanticDispatch({
                type: 'SET_PROVIDERS',
                module_key,
                providers,
              });
              setProvidersPanelOpen(false);
            }}
            onClose={() => setProvidersPanelOpen(false)}
          />
        )}

        {/* Locals panel */}
        {localsPanelOpen && (
          <LocalsPanel
            locals={graph.locals}
            onSave={(locals) => {
              semanticDispatch({
                type: 'SET_LOCALS',
                module_key,
                locals,
              });
              setLocalsPanelOpen(false);
            }}
            onClose={() => setLocalsPanelOpen(false)}
          />
        )}

        {/* Environments panel */}
        {environmentsPanelOpen && (
          <EnvironmentsPanel
            environments={workspace.environments}
            environment_backends={workspace.environment_backends}
            onSave={(environments, backends) => {
              semanticDispatch({
                type: 'SET_ENVIRONMENTS',
                environments,
              });
              semanticDispatch({
                type: 'SET_ENVIRONMENT_BACKENDS',
                backends,
              });
              setEnvironmentsPanelOpen(false);
            }}
            onClose={() => setEnvironmentsPanelOpen(false)}
          />
        )}
      </div>
    </CanvasContext.Provider>
  );
}
