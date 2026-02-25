// src/webview/Canvas.tsx
import React, { useEffect, useState, useReducer, useMemo, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  ControlButton,
  MiniMap,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';

import ModuleNode from './components/nodes/ModuleNode';
import SlidePanel from './components/SlidePanel';
import { ErrorState } from './components/ErrorBoundary';
import ModuleConfigPanel from './components/panels/ModuleConfigPanel';
import EdgeConfigPanel from './components/panels/EdgeConfigPanel';
import VariablesPanel from './components/panels/VariablesPanel';
import OutputsPanel from './components/panels/OutputsPanel';
import TerraformConfigPanel from './components/panels/TerraformConfigPanel';
import ProvidersPanel from './components/panels/ProvidersPanel';
import LocalsPanel from './components/panels/LocalsPanel';
import EnvironmentsPanel from './components/panels/EnvironmentsPanel';

import type { WorkspaceState, GraphLayout } from './types/workspace';
import type { ModuleBundle, CompositeGraph } from './types/ir';
import { isOut } from './types/ir';
import type { WebviewToHost } from '../types/protocol';

import { workspaceReducer, type WorkspaceAction } from './state/reducer';
import { CanvasContext, type CanvasCallbacks } from './state/context';
import { deriveEdges } from './utils/derive';
import { resolveSchema, resolveIconUrl } from './utils/resolve';
import { toBundle, fromBundle, emptyWorkspace } from './utils/bundle';

// ── Node types registration ──

const nodeTypes = {
  moduleNode: ModuleNode,
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
  onEdgesDelete: (edges: Edge[]) => void;
  onNodesDelete: (nodes: Node[]) => void;
  onSave: () => void;
  onRefresh: () => void;
  onClearGraph: () => void;
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
  onEdgesDelete,
  onNodesDelete,
  onSave,
  onRefresh,
  onClearGraph,
}: CompositeEditorProps) {
  const { fitView } = useReactFlow();

  // ── Imperative fitView on load, drop, and navigation ──
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.2, maxZoom: 1.5 }), 50);
    return () => clearTimeout(timer);
  }, [fitViewTrigger, fitView]);

  // ── Derive ReactFlow edges (bundle labels for same source→target pair) ──
  const rfEdgesFromWorkspace: Edge[] = useMemo(() => {
    const derived = deriveEdges(graph.instances);

    // Group by source→target pair to bundle labels
    const pairCount = new Map<string, number>();
    const pairLabels = new Map<string, string[]>();
    for (const e of derived) {
      const pairKey = `${e.source_instance}→${e.target_instance}`;
      pairLabels.set(pairKey, [
        ...(pairLabels.get(pairKey) ?? []),
        `${e.mapping.from} → ${e.mapping.to}`,
      ]);
    }

    return derived.map((e) => {
      const pairKey = `${e.source_instance}→${e.target_instance}`;
      const count = (pairCount.get(pairKey) ?? 0) + 1;
      pairCount.set(pairKey, count);

      const isFirst = count === 1;
      const labels = pairLabels.get(pairKey) ?? [];
      const bundledLabel = labels.length > 1 ? labels.join('\n') : labels[0];

      return {
        id: `${e.source_instance}:${e.mapping.from}-${e.target_instance}:${e.mapping.to}`,
        source: e.source_instance,
        sourceHandle: 'out-right',
        target: e.target_instance,
        targetHandle: 'in-left',
        data: { mapping: e.mapping },
        ...(isFirst
          ? {
              label: bundledLabel,
              labelStyle: { fill: '#CEFE65', fontSize: 10 },
              labelBgPadding: [4, 2] as [number, number],
              labelBgBorderRadius: 4,
              labelBgStyle: { fill: 'rgba(22,22,22,0.85)' },
            }
          : {
              labelStyle: { fill: '#CEFE65', fontSize: 10 },
              labelBgPadding: [0, 0] as [number, number],
              labelBgBorderRadius: 0,
              labelBgStyle: { fill: 'transparent' },
            }),
      };
    });
  }, [graph.instances]);

  // ── Local edge state (for selection support) ──
  const [rfEdges, setRfEdges] = useState<Edge[]>(rfEdgesFromWorkspace);
  useEffect(() => {
    setRfEdges(rfEdgesFromWorkspace);
  }, [rfEdgesFromWorkspace]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  // ── Derive connected handles per node (for handle visibility) ──
  const connectedHandlesMap: Record<string, string[]> = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const edge of rfEdgesFromWorkspace) {
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
  }, [rfEdgesFromWorkspace]);

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
        type: 'moduleNode',
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
      onEdgesChange={onEdgesChange}
      onEdgesDelete={onEdgesDelete}
      onNodesDelete={onNodesDelete}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      minZoom={0.1}
      maxZoom={4}
      style={gridStyle}
      proOptions={{ hideAttribution: true }}
    >
      <MiniMap
        position="bottom-left"
        nodeColor="#CEFE65"
        maskColor="rgba(22,22,22,0.8)"
        bgColor="#153238"
        pannable
        zoomable
      />
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
        <ControlButton
          onClick={onRefresh}
          title="Refresh modules from registry"
          aria-label="Refresh modules"
          className="react-flow__controls-button"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
        </ControlButton>
        <ControlButton
          onClick={onClearGraph}
          title="Clear all modules"
          aria-label="Clear all"
          className="react-flow__controls-button"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
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

  // ── Active module key (entry composite) ──
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
    if (action.type !== 'LOAD_WORKSPACE') {
      setIsDirty(true);
      postToHost({ command: 'markDirty' });
    }
  }, []);

  // ── Save action (used by Controls save button + Cmd+S) ──
  const onSave = useCallback(() => {
    postToHost({ command: 'saveState', state: workspaceRef.current });
  }, []);

  // ── Refresh action (re-fetch module defs from registry) ──
  const onRefresh = useCallback(() => {
    const ws = workspaceRef.current;
    const entryKey = `${ws.entry.module_id}@${ws.entry.version}`;
    const module_keys: Record<string, { id: string; version: string }> = {};
    for (const [key, def] of Object.entries(ws.modules)) {
      if (key !== entryKey) {
        module_keys[key] = { id: def.id, version: def.version };
      }
    }
    postToHost({ command: 'refreshModules', module_keys });
    setStatusMessage('Refreshing...');
    setTimeout(() => setStatusMessage(null), 5000);
  }, []);

  // ── Single-module refresh (called from ModuleNode hover button) ──
  const refreshSingleModule = useCallback((moduleKey: string, id: string, version: string) => {
    postToHost({
      command: 'refreshModules',
      module_keys: { [moduleKey]: { id, version } },
    });
    setStatusMessage('Refreshing...');
    setTimeout(() => setStatusMessage(null), 5000);
  }, []);

  // ── Expose dispatch globally for ModuleNode rename/delete/refresh ──
  useEffect(() => {
    (window as any).__canvasDispatch = semanticDispatch;
    (window as any).__activeModuleKey = module_key;
    (window as any).__canvasRefreshModule = refreshSingleModule;
    return () => {
      delete (window as any).__canvasDispatch;
      delete (window as any).__activeModuleKey;
      delete (window as any).__canvasRefreshModule;
    };
  }, [semanticDispatch, module_key, refreshSingleModule]);

  // ── Context callbacks for nodes ──
  const callbacks: CanvasCallbacks = useMemo(
    () => ({
      openConfig: (id) => setConfigTarget(id),
      markDirty: () => {
        setIsDirty(true);
        postToHost({ command: 'markDirty' });
      },
    }),
    [],
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

  // ── Event: edge delete (select edge + Delete/Backspace) ──
  const onEdgesDelete = useCallback(
    (edges: Edge[]) => {
      const mk = moduleKeyRef.current;
      for (const edge of edges) {
        const mapping = edge.data?.mapping as { from: string; to: string } | undefined;
        if (mapping) {
          semanticDispatch({
            type: 'DISCONNECT',
            module_key: mk,
            target_instance: edge.target,
            input_name: mapping.to,
          });
        }
      }
    },
    [semanticDispatch],
  );

  // ── Event: node delete (select node + Delete/Backspace) ──
  const onNodesDelete = useCallback(
    (nodes: Node[]) => {
      const mk = moduleKeyRef.current;
      for (const node of nodes) {
        semanticDispatch({
          type: 'DELETE_INSTANCE',
          module_key: mk,
          instance_id: node.id,
        });
      }
    },
    [semanticDispatch],
  );

  // ── Event: clear all modules from graph ──
  const onClearGraph = useCallback(() => {
    if (!window.confirm('Remove all modules from the canvas?')) return;
    semanticDispatch({
      type: 'CLEAR_GRAPH',
      module_key: moduleKeyRef.current,
    });
  }, [semanticDispatch]);

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

        case 'refreshModuleDefs': {
          const updatedModules = msg.updated_modules;
          if (updatedModules && Object.keys(updatedModules).length > 0) {
            semanticDispatch({
              type: 'REFRESH_MODULE_DEFS',
              updated_modules: updatedModules,
            });
            // Update icon map if provided
            const iconUpdates: Record<string, string> | undefined = msg.icon_updates;
            if (iconUpdates) {
              setIconMap((prev) => ({ ...prev, ...iconUpdates }));
            }
            const count = Object.keys(updatedModules).length;
            setStatusMessage(`Refreshed ${count} module(s)`);
          } else {
            setStatusMessage('All modules up to date');
          }
          // Host sends triggerSave after this to persist the reconciled state.
          setTimeout(() => setStatusMessage(null), 3000);
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
            onEdgesDelete={onEdgesDelete}
            onNodesDelete={onNodesDelete}
            onSave={onSave}
            onRefresh={onRefresh}
            onClearGraph={onClearGraph}
          />

          {/* Module config panel */}
          <SlidePanel open={!!(configTarget && configInstance && configSchema)}>
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
                onDisconnect={(input_name) => {
                  semanticDispatch({
                    type: 'DISCONNECT',
                    module_key,
                    target_instance: configTarget,
                    input_name,
                  });
                  setConfigTarget(null);
                }}
                onClose={() => setConfigTarget(null)}
              />
            )}
          </SlidePanel>

          {/* Edge config panel */}
          <SlidePanel open={!!(edgeConfigState && edgeSourceInst && edgeTargetInst)} zIndex={40}>
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
          </SlidePanel>

          {/* Variables panel */}
          <SlidePanel open={variablesPanelOpen}>
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
          </SlidePanel>

          {/* Outputs panel */}
          <SlidePanel open={outputsPanelOpen}>
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
          </SlidePanel>

          {/* Terraform config panel */}
          <SlidePanel open={terraformPanelOpen}>
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
          </SlidePanel>

          {/* Providers panel */}
          <SlidePanel open={providersPanelOpen}>
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
          </SlidePanel>

          {/* Locals panel */}
          <SlidePanel open={localsPanelOpen}>
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
          </SlidePanel>

          {/* Environments panel */}
          <SlidePanel open={environmentsPanelOpen}>
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
          </SlidePanel>
        </div>
      </div>
    </CanvasContext.Provider>
  );
}
