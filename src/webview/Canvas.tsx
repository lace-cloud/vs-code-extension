// src/webview/Canvas.tsx
import React, { useEffect, useState, useReducer, useMemo, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  ControlButton,
  useReactFlow,
  applyNodeChanges,
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
import { resolveSchema, resolveNodeType, resolveIconUrl } from './utils/resolve';
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
  fitViewTrigger: number;
  iconMap: Record<string, string>;
  onDragStop: (positions: Record<string, { x: number; y: number }>) => void;
  onConnect: (conn: Connection) => void;
  onSave: () => void;
};

function CompositeEditor({
  graph,
  layout,
  workspace,
  module_key,
  validationErrors,
  fitViewTrigger,
  iconMap,
  onDragStop,
  onConnect,
  onSave,
}: CompositeEditorProps) {
  const { fitView } = useReactFlow();

  // ── Imperative fitView on load, drop, and navigation ──
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.2 }), 50);
    return () => clearTimeout(timer);
  }, [fitViewTrigger, fitView]);

  // ── Derive ReactFlow edges ──
  const rfEdges: Edge[] = useMemo(
    () =>
      deriveEdges(graph.instances).map((e) => ({
        id: `${e.source_instance}:${e.mapping.from}-${e.target_instance}:${e.mapping.to}`,
        source: e.source_instance,
        sourceHandle: 'out-right',
        target: e.target_instance,
        targetHandle: 'in-left',
        data: { mapping: e.mapping },
        label: `${e.mapping.from} → ${e.mapping.to}`,
        labelStyle: { fill: '#CEFE65', fontSize: 10 },
        labelBgPadding: [0, 0] as [number, number],
        labelBgBorderRadius: 0,
        labelBgStyle: { fill: 'transparent' },
      })),
    [graph.instances],
  );

  // ── Derive connected handles per node (for handle visibility) ──
  const connectedHandlesMap: Record<string, string[]> = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const edge of rfEdges) {
      if (!map[edge.source]) map[edge.source] = new Set();
      if (!map[edge.target]) map[edge.target] = new Set();
      map[edge.source].add(edge.sourceHandle ?? 'out-right');
      map[edge.target].add(edge.targetHandle ?? 'in-left');
    }
    const result: Record<string, string[]> = {};
    for (const [id, set] of Object.entries(map)) {
      result[id] = [...set];
    }
    return result;
  }, [rfEdges]);

  // ── Derive ReactFlow nodes from workspace state ──
  // Position resolution: saved layout → auto-grid fallback → origin.
  // Auto-grid is a pure computation — never persisted. Positions are only
  // written to workspace when the user drags (onDragStop → SYNC_LAYOUT).
  const rfNodesFromWorkspace: Node[] = useMemo(() => {
    // Auto-layout for nodes without saved positions
    const cols = Math.max(2, Math.ceil(Math.sqrt(graph.instances.length)));
    const SPACING_X = 120;
    const SPACING_Y = 100;
    const BASE = { x: 80, y: 80 };

    return graph.instances.map((inst, i) => {
      const saved = layout?.nodes[inst.id]?.position;
      const auto = {
        x: BASE.x + (i % cols) * SPACING_X,
        y: BASE.y + Math.floor(i / cols) * SPACING_Y,
      };
      const nodeErrors = validationErrors.filter(
        (e) => e.instance_id === inst.id && e.module_key === module_key,
      );
      return {
        id: inst.id,
        type: resolveNodeType(workspace, inst),
        position: saved ?? auto,
        data: {
          instance: inst,
          schema: resolveSchema(workspace, inst),
          icon_url: resolveIconUrl(inst, iconMap),
          hasErrors: nodeErrors.length > 0,
          errorMessages: nodeErrors.map((e) => e.message),
          connectedHandles: connectedHandlesMap[inst.id] ?? [],
        },
      };
    });
  }, [
    graph.instances,
    layout,
    workspace,
    validationErrors,
    module_key,
    iconMap,
    connectedHandlesMap,
  ]);

  // ── Local ReactFlow node state ──
  // ReactFlow in controlled mode needs ALL changes (position, dimensions,
  // selection) applied via applyNodeChanges. This state is the single owner
  // of node data that ReactFlow renders.
  const [rfNodes, setRfNodes] = useState<Node[]>(rfNodesFromWorkspace);

  // Re-sync when workspace changes (new drops, renames, deletes).
  // Preserves ReactFlow-managed fields (measured, width, height, selected)
  // and drag positions on existing nodes while updating type/data and
  // adding/removing nodes to match the workspace.
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return rfNodesFromWorkspace.map((wn) => {
        const existing = prevById.get(wn.id);
        if (existing) {
          return {
            ...existing,
            type: wn.type,
            data: wn.data,
            // Existing nodes keep their ReactFlow-managed position (drag state).
            // New position from workspace (e.g. a layout sync) would require
            // remount, which we handle via key={module_key} on the parent.
          };
        }
        return wn; // New node — use workspace position
      });
    });
  }, [rfNodesFromWorkspace]);

  // ── Handle ALL ReactFlow node changes (position, dimensions, select) ──
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  // ── Sync positions back to workspace on drag stop ──
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, _node: Node, nodes: Node[]) => {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of nodes) {
        positions[n.id] = n.position;
      }
      onDragStop(positions);
    },
    [onDragStop],
  );

  // Fixed grid background (CSS — does not zoom/pan with the graph)
  const gridStyle = {
    background: '#161616',
    backgroundImage: [
      'linear-gradient(rgba(206,254,101,0.035) 1px, transparent 1px)',
      'linear-gradient(90deg, rgba(206,254,101,0.035) 1px, transparent 1px)',
      'linear-gradient(rgba(206,254,101,0.07) 1px, transparent 1px)',
      'linear-gradient(90deg, rgba(206,254,101,0.07) 1px, transparent 1px)',
    ].join(', '),
    backgroundSize: '16px 16px, 16px 16px, 80px 80px, 80px 80px',
  };

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      style={gridStyle}
      proOptions={{ hideAttribution: true }}
    >
      <Controls position="bottom-right" showInteractive={false}>
        <ControlButton
          onClick={onSave}
          title="Save (Cmd+S)"
          aria-label="Save"
          className="react-flow__controls-button"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4zm-5 16a3 3 0 110-6 3 3 0 010 6zm3-10H5V5h10v4z" />
          </svg>
        </ControlButton>
      </Controls>
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
  const [_isDirty, setIsDirty] = useState(false);

  // Generation counter: incremented on LOAD_WORKSPACE to force CompositeEditor
  // remount (via key) even when the module_key doesn't change.
  const [loadGeneration, setLoadGeneration] = useState(0);

  // Trigger counter for imperative fitView calls (incremented on load/drop/navigate)
  const [fitViewTrigger, setFitViewTrigger] = useState(0);

  // Icon URL mappings: module_key → icon_url (populated from registry metadata on drop)
  const [iconMap, setIconMap] = useState<Record<string, string>>({});

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
      setConfigTarget(null);
      setEdgeConfigState(null);
      setFitViewTrigger((n) => n + 1);
    },
    [active_key],
  );

  const navigateTo = useCallback((index: number) => {
    setBreadcrumb((prev) => prev.slice(0, index + 1));
    setConfigTarget(null);
    setEdgeConfigState(null);
    setFitViewTrigger((n) => n + 1);
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
    if (action.type !== 'LOAD_WORKSPACE') {
      setIsDirty(true);
      postToHost({ command: 'markDirty' });
    }
  }, []);

  // ── Save action (used by Controls save button + Cmd+S) ──
  const onSave = useCallback(() => {
    postToHost({ command: 'saveState', state: workspaceRef.current });
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
      markDirty: () => {
        setIsDirty(true);
        postToHost({ command: 'markDirty' });
      },
    }),
    [navigateIn],
  );

  // ── Event: drag stop → sync layout to workspace (marks dirty) ──
  const onDragStop = useCallback(
    (positions: Record<string, { x: number; y: number }>) => {
      semanticDispatch({
        type: 'SYNC_LAYOUT',
        module_key: moduleKeyRef.current,
        positions,
      });
    },
    [semanticDispatch],
  );

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
          setIsDirty(false);
          setLoadGeneration((n) => n + 1);
          setFitViewTrigger((n) => n + 1);
          // Breadcrumb resets via the entry_key useEffect
          break;
        }

        case 'triggerSave': {
          // User-initiated save (Cmd+S or save button)
          postToHost({ command: 'saveState', state: workspaceRef.current });
          break;
        }

        case 'saveConfirmed': {
          setIsDirty(false);
          setStatusMessage('Saved');
          setTimeout(() => setStatusMessage(null), 1500);
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

          // Store icon_url for this module (from registry metadata)
          const dropIconUrl: string | undefined = msg.icon_url;
          if (dropIconUrl) {
            const iconKey = `${deployBundle.entry.module_id}@${deployBundle.entry.version}`;
            setIconMap((prev) => ({ ...prev, [iconKey]: dropIconUrl }));
          }

          // Parse through fromBundle to normalize bindings
          const { workspace: parsed, errors } = fromBundle(deployBundle);
          if (errors.length > 0) {
            console.warn('Deploy bundle parse errors:', errors);
          }

          // Build positions map for entry composite's instances
          const entryKey = `${deployBundle.entry.module_id}@${deployBundle.entry.version}`;
          const entryDef = parsed.modules[entryKey];
          const positions: Record<string, { x: number; y: number }> = {};

          // Count existing instances to offset new drops
          const currentDef = workspaceRef.current.modules[moduleKeyRef.current];
          const existingCount =
            currentDef?.impl.kind === 'composite' ? currentDef.impl.graph.instances.length : 0;

          if (entryDef?.impl.kind === 'composite') {
            const instances = entryDef.impl.graph.instances;
            const cols = Math.max(2, Math.ceil(Math.sqrt(instances.length)));

            // Offset each successive drop: arrange in a grid with spacing
            const offsetCol = existingCount % 4;
            const offsetRow = Math.floor(existingCount / 4);
            const basePos = { x: 100 + offsetCol * 120, y: 100 + offsetRow * 100 };

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
          setFitViewTrigger((n) => n + 1);
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
      <div className="h-screen flex flex-col relative">
        {/* Breadcrumb navigation */}
        <Breadcrumb path={breadcrumb} onNavigate={navigateTo} />

        {statusMessage && (
          <div className="absolute top-11 left-4 z-20 bg-[#153238] text-[#CEFE65] border border-[rgba(206,254,101,0.2)] px-3 py-1.5 rounded-md text-xs shadow-[0_2px_6px_rgba(0,0,0,0.3)]">
            {statusMessage}
          </div>
        )}

        <div className="flex-1 relative min-h-0">
          <CompositeEditor
            key={`${module_key}:${loadGeneration}`}
            graph={graph}
            layout={layout}
            workspace={workspace}
            module_key={module_key}
            validationErrors={validationErrors}
            fitViewTrigger={fitViewTrigger}
            iconMap={iconMap}
            onDragStop={onDragStop}
            onConnect={onConnect}
            onSave={onSave}
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
      </div>
    </CanvasContext.Provider>
  );
}
