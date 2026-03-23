// src/webview/Canvas.tsx
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  MarkerType,
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
import UnifiedSettingsPanel from './components/panels/UnifiedSettingsPanel';
import ActionBar from './components/ActionBar';

import type { CanvasView, RenderNode, RenderEdge } from './types/render';
import type { GeneratePhase } from '../types/protocol';
import { useCanvas } from './state/engine-context';

// ── Node types registration ──

const nodeTypes = {
  moduleNode: ModuleNode,
};

// ── Toast ──

const TOAST_BRIEF = 1500;
const TOAST_INFO = 3000;

type ToastState = { message: string; type: 'progress' | 'success' | 'error' } | null;

const PHASE_LABELS: Record<GeneratePhase, string> = {
  generating: 'Generating Terraform...',
  formatting: 'Formatting...',
  validating: 'Validating...',
};

// ══════════════════════════════════════════════════════════════════════
// CompositeEditor — renders the ReactFlow viewport for a valid graph.
//
// Separated from Canvas so that its hooks (useMemo for rfNodes/rfEdges)
// only mount when a valid CanvasView exists. This avoids React's
// "rendered fewer hooks" error (#300) — Canvas can safely early-return
// <ErrorState> without skipping any hooks, because the graph-dependent
// hooks live here and are never mounted in the error path.
// ══════════════════════════════════════════════════════════════════════

type CompositeEditorProps = {
  view: CanvasView;
  isGenerating: boolean;
  onDragStop: (positions: Record<string, { x: number; y: number }>) => void;
  onConnect: (conn: Connection) => void;
  onEdgesDelete: (edges: Edge[]) => void;
  onNodesDelete: (nodes: Node[]) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearGraph: () => void;
  onGenerate: () => void;
  onOpenSettings: () => void;
};

function CompositeEditor({
  view,
  isGenerating,
  onDragStop,
  onConnect,
  onEdgesDelete,
  onNodesDelete,
  onSave,
  onUndo,
  onRedo,
  onClearGraph,
  onGenerate,
  onOpenSettings,
}: CompositeEditorProps) {
  const { fitView } = useReactFlow();

  // ── Imperative fitView on initial mount only ──
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.2, maxZoom: 1.5 }), 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derive ReactFlow edges from CanvasView ──
  const rfEdgesFromView: Edge[] = useMemo(() => {
    return view.edges.map((e: RenderEdge) => ({
      id: e.id,
      source: e.source,
      sourceHandle: 'out-right',
      target: e.target,
      targetHandle: 'in-left',
      label: `${e.source_output} → ${e.target_input}`,
      labelStyle: { fill: '#ECEFED', fontSize: 10, fontFamily: 'monospace', opacity: 0.85 },
      labelBgStyle: { fill: '#153238', opacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
      data: { source_output: e.source_output, target_input: e.target_input },
    }));
  }, [view.edges]);

  // ── Local edge state (for selection support) ──
  const [rfEdges, setRfEdges] = useState<Edge[]>(rfEdgesFromView);
  useEffect(() => {
    setRfEdges(rfEdgesFromView);
  }, [rfEdgesFromView]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  // ── Derive connected handles per node (for handle visibility) ──
  const connectedHandlesMap: Record<string, string[]> = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const edge of rfEdgesFromView) {
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
  }, [rfEdgesFromView]);

  // ── Derive ReactFlow nodes from CanvasView ──
  const rfNodesFromView: Node[] = useMemo(
    () =>
      view.nodes.map((node: RenderNode) => ({
        id: node.id,
        type: 'moduleNode',
        position: node.position,
        data: {
          ...node,
          connectedHandles: connectedHandlesMap[node.id] ?? [],
        },
      })),
    [view.nodes, connectedHandlesMap],
  );

  // ── Local ReactFlow node state ──
  const [rfNodes, setRfNodes] = useState<Node[]>(rfNodesFromView);

  // Re-sync when view changes (new drops, renames, deletes).
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return rfNodesFromView.map((wn) => {
        const existing = prevById.get(wn.id);
        if (existing) {
          return {
            ...existing,
            type: wn.type,
            data: wn.data,
          };
        }
        return wn;
      });
    });
  }, [rfNodesFromView]);

  // ── Handle ALL ReactFlow node changes (position, dimensions, select) ──
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  // ── Sync positions back to engine on drag stop ──
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

  // Fixed grid background
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
      connectionMode="loose"
      defaultEdgeOptions={{
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#CEFE65', width: 16, height: 16 },
        style: { stroke: '#CEFE65', strokeWidth: 1.5 },
      }}
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
      <Controls position="bottom-right" showInteractive={false} />
      <ActionBar
        isGenerating={isGenerating}
        onSave={onSave}
        onUndo={onUndo}
        onRedo={onRedo}
        onClearGraph={onClearGraph}
        onGenerate={onGenerate}
        onOpenSettings={onOpenSettings}
      />
    </ReactFlow>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Canvas — top-level component that renders the CanvasView from the
// engine context. All IR logic is in the CLI — we only render.
// ══════════════════════════════════════════════════════════════════════

export default function Canvas() {
  const { state, engine, updateView } = useCanvas();

  const [configTarget, setConfigTarget] = useState<string | null>(null);
  const [edgeConfigState, setEdgeConfigState] = useState<{
    source: string;
    target: string;
  } | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [generating, setGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Listen for openNodeConfig events from ModuleNode ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.instanceId) {
        setConfigTarget(detail.instanceId);
      }
    };
    window.addEventListener('openNodeConfig', handler);
    return () => window.removeEventListener('openNodeConfig', handler);
  }, []);

  // ── Listen for canvasViewUpdated events (e.g., delete from node button) ──
  useEffect(() => {
    const handler = (e: Event) => {
      const view = (e as CustomEvent).detail;
      if (view) {
        setConfigTarget(null);
        updateView(view);
      }
    };
    window.addEventListener('canvasViewUpdated', handler);
    return () => window.removeEventListener('canvasViewUpdated', handler);
  }, [updateView]);

  // ── Undo/Redo via engine ──
  const onUndo = useCallback(async () => {
    if (!engine || !state.view?.can_undo) return;
    const result = await engine.undo();
    updateView(result);
  }, [engine, state.view?.can_undo, updateView]);

  const onRedo = useCallback(async () => {
    if (!engine || !state.view?.can_redo) return;
    const result = await engine.redo();
    updateView(result);
  }, [engine, state.view?.can_redo, updateView]);

  // ── Save via engine ──
  const onSave = useCallback(async () => {
    if (!engine) return;
    await engine.sessionSave();
    setToast({ message: 'Saved', type: 'success' });
    setTimeout(() => setToast(null), TOAST_BRIEF);
  }, [engine]);

  // ── Generate via host (correct output dir + error filtering) ──
  const onGenerate = useCallback(() => {
    window.dispatchEvent(new CustomEvent('canvasGenerate'));
  }, []);

  // ── Expose undo globally for HTML-level Cmd+Z listener ──
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__canvasUndo = onUndo;
    return () => {
      delete (window as unknown as Record<string, unknown>).__canvasUndo;
    };
  }, [onUndo]);

  // ── Event: drag stop → sync layout to engine ──
  const onDragStop = useCallback(
    async (positions: Record<string, { x: number; y: number }>) => {
      if (!engine) return;
      await engine.syncLayout(positions);
    },
    [engine],
  );

  // ── Event: new connection ──
  const onConnect = useCallback(
    async (conn: Connection) => {
      if (!conn.source || !conn.target || !engine) return;

      const edgesBefore = state.view?.edges.length ?? 0;

      try {
        const result = await engine.autoConnect(conn.source, conn.target);
        const edgesAfter = result.edges?.length ?? 0;

        if (edgesAfter > edgesBefore) {
          updateView(result);
        } else {
          setEdgeConfigState({ source: conn.source, target: conn.target });
        }
      } catch {
        setEdgeConfigState({ source: conn.source, target: conn.target });
      }
    },
    [engine, state.view?.edges.length, updateView],
  );

  // ── Event: edge delete (select edge + Delete/Backspace) ──
  const onEdgesDelete = useCallback(
    async (edges: Edge[]) => {
      if (!engine) return;
      for (const edge of edges) {
        const targetInput = edge.data?.target_input as string | undefined;
        if (targetInput) {
          const result = await engine.disconnect(edge.target, targetInput);
          updateView(result);
        }
      }
    },
    [engine, updateView],
  );

  // ── Event: node delete (select node + Delete/Backspace) ──
  const onNodesDelete = useCallback(
    async (nodes: Node[]) => {
      if (!engine) return;
      for (const node of nodes) {
        const result = await engine.deleteInstance(node.id);
        updateView(result);
      }
    },
    [engine, updateView],
  );

  // ── Event: clear all modules from graph ──
  const onClearGraph = useCallback(async () => {
    if (!engine || !state.view) return;
    // Delete all nodes
    for (const node of state.view.nodes) {
      const result = await engine.deleteInstance(node.id);
      updateView(result);
    }
  }, [engine, state.view, updateView]);

  // ── Open settings panel ──
  const onOpenSettings = useCallback(() => {
    setSettingsOpen(true);
    setConfigTarget(null);
  }, []);

  // ── Handle edge config connect ──
  const handleEdgeConnect = useCallback(
    async (source: string, target: string, outputName: string, inputName: string) => {
      if (!engine) return;
      const result = await engine.connect(source, target, outputName, inputName);
      updateView(result);
      setEdgeConfigState(null);
    },
    [engine, updateView],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      switch (msg.command) {
        case 'generateProgress': {
          setGenerating(true);
          setToast({ message: PHASE_LABELS[msg.phase as GeneratePhase], type: 'progress' });
          break;
        }
        case 'generateSuccess': {
          setGenerating(false);
          setToast({ message: 'Successfully generated', type: 'success' });
          setTimeout(() => setToast(null), TOAST_INFO);
          break;
        }
        case 'generateError': {
          setGenerating(false);
          setToast({ message: `Generate error: ${msg.message}`, type: 'error' });
          setTimeout(() => setToast(null), TOAST_INFO);
          break;
        }
      }
    };

    window.addEventListener('hostMessage', handler);
    return () => window.removeEventListener('hostMessage', handler);
  }, []);

  // ── Guard: need a view to render ──
  if (state.loading || !state.view) {
    if (state.error) {
      return <ErrorState message={state.error} />;
    }
    return (
      <div className="h-screen flex items-center justify-center text-[#999] text-sm">
        Loading canvas...
      </div>
    );
  }

  if (!engine) {
    return <ErrorState message="Engine not available." />;
  }

  const view = state.view;

  // ── Render ──
  return (
    <div className="h-screen flex flex-col relative">
      {toast && (
        <div
          className={`absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-md text-xs shadow-[0_2px_6px_rgba(0,0,0,0.3)] border ${
            toast.type === 'error'
              ? 'bg-[#3a1518] text-[#f87171] border-[rgba(248,113,113,0.3)]'
              : 'bg-[#153238] text-[#CEFE65] border-[rgba(206,254,101,0.2)]'
          }`}
        >
          {toast.type === 'progress' && (
            <div className="w-3.5 h-3.5 border-2 border-[#CEFE65] border-t-transparent rounded-full animate-spin" />
          )}
          {toast.message}
        </div>
      )}

      <div className="flex-1 relative min-h-0">
        <CompositeEditor
          view={view}
          isGenerating={generating}
          onDragStop={onDragStop}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onNodesDelete={onNodesDelete}
          onSave={onSave}
          onUndo={onUndo}
          onRedo={onRedo}
          onClearGraph={onClearGraph}
          onGenerate={onGenerate}
          onOpenSettings={onOpenSettings}
        />

        {/* Module config panel */}
        <SlidePanel open={!!configTarget}>
          {configTarget && (
            <ModuleConfigPanel
              instance_id={configTarget}
              engine={engine}
              onClose={() => setConfigTarget(null)}
            />
          )}
        </SlidePanel>

        {/* Edge config panel */}
        <SlidePanel open={!!edgeConfigState} zIndex={40}>
          {edgeConfigState && (
            <EdgeConfigPanel
              source_instance={edgeConfigState.source}
              target_instance={edgeConfigState.target}
              engine={engine}
              onConnect={handleEdgeConnect}
              onClose={() => setEdgeConfigState(null)}
            />
          )}
        </SlidePanel>

        {/* Unified settings panel */}
        <SlidePanel open={settingsOpen}>
          {settingsOpen && (
            <UnifiedSettingsPanel engine={engine} onClose={() => setSettingsOpen(false)} />
          )}
        </SlidePanel>
      </div>
    </div>
  );
}
