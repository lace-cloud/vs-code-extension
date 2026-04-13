// src/webview/Canvas.tsx
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
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
import EdgeInspectorPanel from './components/panels/EdgeInspectorPanel';
import UnifiedSettingsPanel from './components/panels/UnifiedSettingsPanel';
import ActionBar from './components/ActionBar';
import { ValidationErrorBanner } from './components/ValidationErrorBanner';

import type { CanvasView, RenderNode, RenderEdge } from './types/render';
import type { GeneratePhase, Diagnostic } from '../types/protocol';
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

// parseHandleId extracts the variable name from a handle ID of the form
// "in:<name>" or "out:<name>". Returns null if the handle is missing or
// doesn't match the expected prefix (e.g. a legacy cardinal handle).
function parseHandleId(handleId: string | null | undefined, prefix: 'in' | 'out'): string | null {
  if (!handleId) return null;
  const marker = `${prefix}:`;
  if (!handleId.startsWith(marker)) return null;
  const name = handleId.slice(marker.length);
  return name.length > 0 ? name : null;
}

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
  erroredNodeIds: Set<string>;
  newNodeIds: Set<string>;
  forcePositionsRef: React.MutableRefObject<boolean>;
  onDragStop: (positions: Record<string, { x: number; y: number }>) => void;
  onConnect: (conn: Connection) => void;
  onEdgeClick: (e: React.MouseEvent, edge: Edge) => void;
  onEdgesDelete: (edges: Edge[]) => void;
  onNodesDelete: (nodes: Node[]) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearGraph: () => void;
  onGenerate: () => void;
  onOpenSettings: () => void;
  registerGoToNode: (fn: (nodeId: string) => void) => void;
  registerZoomToNode: (fn: (nodeId: string) => void) => void;
  registerGetSelectedIds: (fn: () => string[]) => void;
  registerSelectNodes: (fn: (ids: string[]) => void) => void;
};

function CompositeEditor({
  view,
  isGenerating,
  erroredNodeIds,
  newNodeIds,
  forcePositionsRef,
  onDragStop,
  onConnect,
  onEdgeClick,
  onEdgesDelete,
  onNodesDelete,
  onSave,
  onUndo,
  onRedo,
  onClearGraph,
  onGenerate,
  onOpenSettings,
  registerGoToNode,
  registerZoomToNode,
  registerGetSelectedIds,
  registerSelectNodes,
}: CompositeEditorProps) {
  const { fitView, fitBounds, getNode } = useReactFlow();

  // Tracks selected node IDs synchronously — updated in onNodesChange before any React render.
  const selectedIdsRef = useRef<string[]>([]);

  // IDs to mark selected on the next rfNodesFromView sync (set before updateView is called).
  const pendingSelectIdsRef = useRef<string[]>([]);

  // ── Imperative fitView on initial mount only ──
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.2, maxZoom: 1.5 }), 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Register go-to-node handler (needs ReactFlow context) ──
  useEffect(() => {
    registerGoToNode((nodeId: string) => {
      const node = getNode(nodeId);
      if (!node) return;
      const { x, y } = node.position;
      const w = node.measured?.width ?? 60;
      const h = node.measured?.height ?? 60;
      fitBounds({ x, y, width: w, height: h }, { padding: 5.0, duration: 400 });
      // Open config panel
      window.dispatchEvent(new CustomEvent('openNodeConfig', { detail: { instanceId: nodeId } }));
    });
    // registerGoToNode is stable (useCallback in parent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Register zoom-only handler (no panel open) ──
  useEffect(() => {
    registerZoomToNode((nodeId: string) => {
      const node = getNode(nodeId);
      if (!node) return;
      const { x, y } = node.position;
      const w = node.measured?.width ?? 60;
      const h = node.measured?.height ?? 60;
      fitBounds({ x, y, width: w, height: h }, { padding: 4.0, duration: 400 });
    });
    // registerZoomToNode is stable (useCallback in parent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derive ReactFlow edges from CanvasView ──
  // Per-variable handles: each edge anchors to the exact input/output pin,
  // so the wiring is visually unambiguous and we no longer need an edge label.
  const rfEdgesFromView: Edge[] = useMemo(() => {
    return view.edges.map((e: RenderEdge) => ({
      id: e.id,
      source: e.source,
      sourceHandle: `out:${e.source_output}`,
      target: e.target,
      targetHandle: `in:${e.target_input}`,
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

  // ── Derive ReactFlow nodes from CanvasView ──
  // Per-variable handles: each NodePin carries its own `wired` flag from the
  // CLI, so the node component no longer needs a derived map of connected
  // handle IDs — it reads pin.wired directly.
  const rfNodesFromView: Node[] = useMemo(
    () =>
      view.nodes.map((node: RenderNode) => ({
        id: node.id,
        type: 'moduleNode',
        position: node.position,
        data: {
          ...node,
          hasValidationError: erroredNodeIds.has(node.id),
          isNew: newNodeIds.has(node.id),
        },
      })),
    [view.nodes, erroredNodeIds, newNodeIds],
  );

  // ── Local ReactFlow node state ──
  const [rfNodes, setRfNodes] = useState<Node[]>(rfNodesFromView);

  // Re-sync when view changes (new drops, renames, deletes, undo/redo).
  // forcePositionsRef is set to true by onUndo/onRedo so the CLI-authoritative
  // positions from the undo stack are applied instead of the stale ReactFlow positions.
  useEffect(() => {
    const force = forcePositionsRef.current;
    forcePositionsRef.current = false;
    const pendingSelect = pendingSelectIdsRef.current;
    pendingSelectIdsRef.current = [];
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return rfNodesFromView.map((wn) => {
        const existing = prevById.get(wn.id);
        const shouldSelect = pendingSelect.length > 0 && pendingSelect.includes(wn.id);
        if (existing && !force) {
          return {
            ...existing,
            type: wn.type,
            data: wn.data,
            selected: shouldSelect ? true : existing.selected,
          };
        }
        return shouldSelect ? { ...wn, selected: true } : wn;
      });
    });
  }, [rfNodesFromView]);

  // ── Handle ALL ReactFlow node changes (position, dimensions, select) ──
  // Selection changes are applied to selectedIdsRef synchronously here —
  // triggerNodeChanges → onNodesChange is a direct synchronous call from
  // handleNodeClick, so the ref is always current before any React render.
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === 'select') {
        if (change.selected) {
          selectedIdsRef.current = [...new Set([...selectedIdsRef.current, change.id])];
        } else {
          selectedIdsRef.current = selectedIdsRef.current.filter((id) => id !== change.id);
        }
      }
    }
    setRfNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  // ── Expose selected node IDs to Canvas for copy/cut ──
  useEffect(() => {
    registerGetSelectedIds(() => selectedIdsRef.current);
    // registerGetSelectedIds is stable (useCallback in parent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Expose selectNodes to Canvas for post-paste group selection ──
  useEffect(() => {
    registerSelectNodes((ids: string[]) => {
      pendingSelectIdsRef.current = ids;
    });
    // registerSelectNodes is stable (useCallback in parent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      onEdgeClick={onEdgeClick}
      onEdgesDelete={onEdgesDelete}
      onNodesDelete={onNodesDelete}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      defaultEdgeOptions={{
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#CEFE65', width: 16, height: 16 },
        /* stroke & width handled by CSS (.react-flow__edge path) for selection support */
      }}
      connectionRadius={25}
      minZoom={0.1}
      maxZoom={4}
      selectNodesOnDrag={false}
      style={gridStyle}
      proOptions={{ hideAttribution: true }}
      deleteKeyCode={['Delete', 'Backspace']}
      onNodeContextMenu={(event, node) => {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('canvasContextMenu', {
            detail: { instanceId: node.id, x: event.clientX, y: event.clientY },
          }),
        );
      }}
      onSelectionContextMenu={(event) => {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('canvasContextMenu', {
            detail: { instanceId: null, x: event.clientX, y: event.clientY },
          }),
        );
      }}
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

  // Ref to always read the latest view (avoids stale closures in async callbacks)
  const viewRef = useRef(state.view);
  viewRef.current = state.view;

  const [configTarget, setConfigTarget] = useState<string | null>(null);
  const [newNodeIds, setNewNodeIds] = useState<Set<string>>(new Set());
  const prevNodeIdsRef = useRef<Set<string>>(new Set());
  const sessionLoadedRef = useRef(false);
  const [selectedEdge, setSelectedEdge] = useState<{
    id: string;
    source: string;
    target: string;
    sourceOutput: string;
    targetInput: string;
  } | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [generating, setGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Diagnostic[]>([]);
  const [errorBannerDismissed, setErrorBannerDismissed] = useState(false);

  // Signals to CompositeEditor that the next view sync must restore CLI positions (undo/redo).
  const forcePositionsRef = useRef(false);

  // Stable ref for the go-to-node function (implemented inside CompositeEditor)
  const goToNodeRef = useRef<((nodeId: string) => void) | null>(null);
  const registerGoToNode = useCallback((fn: (nodeId: string) => void) => {
    goToNodeRef.current = fn;
  }, []);

  // Stable ref for zoom-only (no panel open) — set by CompositeEditor
  const zoomToNodeRef = useRef<((nodeId: string) => void) | null>(null);
  const registerZoomToNode = useCallback((fn: (nodeId: string) => void) => {
    zoomToNodeRef.current = fn;
  }, []);

  // Stable ref for reading selected node IDs — set by CompositeEditor
  const getSelectedIdsRef = useRef<(() => string[]) | null>(null);
  const registerGetSelectedIds = useCallback((fn: () => string[]) => {
    getSelectedIdsRef.current = fn;
  }, []);

  // Stable ref for selecting nodes by ID — set by CompositeEditor
  const selectNodesRef = useRef<((ids: string[]) => void) | null>(null);
  const registerSelectNodes = useCallback((fn: (ids: string[]) => void) => {
    selectNodesRef.current = fn;
  }, []);

  // ── Clipboard state ──
  const clipboardRef = useRef<string[]>([]);
  const isCutRef = useRef(false);

  // ── Context menu state ──
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string | null;
  } | null>(null);
  const contextMenuNodeIdRef = useRef<string | null>(null);

  // ── Track newly added nodes for "new" (blue border) state ──
  useEffect(() => {
    if (!state.view) return;
    const currentIds = new Set(state.view.nodes.map((n) => n.id));

    if (!sessionLoadedRef.current) {
      // First view from the session: treat all existing nodes as already-known.
      // This covers both: opening an existing session (has nodes) and a fresh
      // blank canvas (has zero nodes). Either way, nothing gets a blue border yet.
      sessionLoadedRef.current = true;
      prevNodeIdsRef.current = currentIds;
      return;
    }

    const prev = prevNodeIdsRef.current;
    const added = state.view.nodes.filter((n) => !prev.has(n.id)).map((n) => n.id);
    setNewNodeIds((s) => {
      const next = new Set([...s].filter((id) => currentIds.has(id)));
      for (const id of added) next.add(id);
      return next.size !== s.size || added.length > 0 ? next : s;
    });
    prevNodeIdsRef.current = currentIds;
  }, [state.view]);

  const clearNew = useCallback((...ids: string[]) => {
    setNewNodeIds((s) => {
      const next = new Set(s);
      let changed = false;
      for (const id of ids) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : s;
    });
  }, []);

  // ── Zoom to last newly added node ──
  const latestNewNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (newNodeIds.size === 0) return;
    const ids = [...newNodeIds];
    const id = ids[ids.length - 1];
    if (id === latestNewNodeIdRef.current) return;
    latestNewNodeIdRef.current = id;
    // Delay to let ReactFlow render/position the node before fitting
    const timer = setTimeout(() => {
      zoomToNodeRef.current?.(id);
    }, 150);
    return () => clearTimeout(timer);
  }, [newNodeIds]);

  // ── Listen for openNodeConfig events from ModuleNode ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.instanceId) {
        setConfigTarget(detail.instanceId);
        // Do NOT clear blue border here — it clears only when a required input is saved
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

  // ── Listen for canvasContextMenu events from CompositeEditor ──
  useEffect(() => {
    const handler = (e: Event) => {
      const { instanceId, x, y } = (e as CustomEvent).detail;
      contextMenuNodeIdRef.current = instanceId;
      setContextMenu({ x, y, nodeId: instanceId });
    };
    window.addEventListener('canvasContextMenu', handler);
    return () => window.removeEventListener('canvasContextMenu', handler);
  }, []);

  // ── Undo/Redo via engine ──
  const onUndo = useCallback(async () => {
    if (!engine || !state.view?.can_undo) return;
    forcePositionsRef.current = true;
    const result = await engine.undo();
    updateView(result);
  }, [engine, state.view?.can_undo, updateView]);

  const onRedo = useCallback(async () => {
    if (!engine || !state.view?.can_redo) return;
    forcePositionsRef.current = true;
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

  // ── Copy/Cut/Paste handlers ──
  const onCopy = useCallback(() => {
    const selected = getSelectedIdsRef.current?.() ?? [];
    const ctx = contextMenuNodeIdRef.current;
    const ids = ctx && !selected.includes(ctx) ? [...selected, ctx] : selected;
    if (ids.length === 0) {
      setToast({ message: 'Nothing selected — click a node first', type: 'error' });
      setTimeout(() => setToast(null), TOAST_BRIEF);
      return;
    }
    clipboardRef.current = ids;
    isCutRef.current = false;
    setContextMenu(null);
    contextMenuNodeIdRef.current = null;
    const copyCount = selected.length > 0 ? selected.length : ids.length;
    setToast({ message: `Copied ${copyCount} node${copyCount > 1 ? 's' : ''}`, type: 'success' });
    setTimeout(() => setToast(null), TOAST_BRIEF);
  }, []);

  const onCut = useCallback(() => {
    const selected = getSelectedIdsRef.current?.() ?? [];
    const ctx = contextMenuNodeIdRef.current;
    const ids = ctx && !selected.includes(ctx) ? [...selected, ctx] : selected;
    if (ids.length === 0) {
      setToast({ message: 'Nothing selected — click a node first', type: 'error' });
      setTimeout(() => setToast(null), TOAST_BRIEF);
      return;
    }
    clipboardRef.current = ids;
    isCutRef.current = true;
    setContextMenu(null);
    contextMenuNodeIdRef.current = null;
    const cutCount = selected.length > 0 ? selected.length : ids.length;
    setToast({ message: `Cut ${cutCount} node${cutCount > 1 ? 's' : ''}`, type: 'success' });
    setTimeout(() => setToast(null), TOAST_BRIEF);
  }, []);

  const onPaste = useCallback(async () => {
    setContextMenu(null);
    contextMenuNodeIdRef.current = null;
    if (!engine || clipboardRef.current.length === 0) {
      setToast({ message: 'Clipboard empty — copy a node first', type: 'error' });
      setTimeout(() => setToast(null), TOAST_BRIEF);
      return;
    }
    const ids = clipboardRef.current;
    try {
      const prevIds = new Set((state.view?.nodes ?? []).map((n) => n.id));
      const result = await engine.copyInstances(ids);
      const newIds = result.nodes
        .filter((n: { id: string }) => !prevIds.has(n.id) && !ids.includes(n.id))
        .map((n: { id: string }) => n.id);
      if (newIds.length > 0) {
        selectNodesRef.current?.(newIds);
      }
      updateView(result);
      if (isCutRef.current) {
        for (const id of ids) {
          const r = await engine.deleteInstance(id);
          updateView(r);
        }
        clipboardRef.current = [];
        isCutRef.current = false;
      }
    } catch (err) {
      console.error('[Canvas] paste failed:', err);
      setToast({ message: 'Paste failed — try again', type: 'error' });
      setTimeout(() => setToast(null), TOAST_BRIEF);
    }
  }, [engine, updateView, state.view]);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__canvasCopy = onCopy;
    w.__canvasCut = onCut;
    w.__canvasPaste = onPaste;
    return () => {
      delete w.__canvasCopy;
      delete w.__canvasCut;
      delete w.__canvasPaste;
    };
  }, [onCopy, onCut, onPaste]);

  // ── Event: drag stop → sync layout to engine ──
  const onDragStop = useCallback(
    async (positions: Record<string, { x: number; y: number }>) => {
      if (!engine) return;
      await engine.syncLayout(positions);
    },
    [engine],
  );

  // ── Event: new connection ──
  // Per-variable handles encode the mapping in their IDs ("out:<name>" →
  // "in:<name>"), so we call engine.connect directly with the resolved pair
  // and skip the old autoConnect/EdgeConfigPanel disambiguation dance.
  // Already-wired targets and type mismatches surface via a toast.
  const onConnect = useCallback(
    async (conn: Connection) => {
      if (!conn.source || !conn.target || !engine) return;

      const srcName = parseHandleId(conn.sourceHandle, 'out');
      const tgtName = parseHandleId(conn.targetHandle, 'in');
      if (!srcName || !tgtName) {
        // Defensive fallback: should never happen with the new node layout,
        // but if a legacy handle ID slips through, let autoConnect try.
        try {
          const result = await engine.autoConnect(conn.source, conn.target);
          updateView(result);
        } catch (err) {
          console.error('[Canvas] autoConnect fallback failed:', err);
        }
        return;
      }

      // Reject if the target input is already wired — a variable can only
      // have one upstream binding. Users must delete the existing edge first.
      const alreadyWired = (viewRef.current?.edges ?? []).some(
        (e) => e.target === conn.target && e.target_input === tgtName,
      );
      if (alreadyWired) {
        setToast({
          message: `${conn.target}.${tgtName} is already wired — delete the existing connection first.`,
          type: 'error',
        });
        setTimeout(() => setToast(null), TOAST_INFO);
        return;
      }

      try {
        const result = await engine.connect(conn.source, conn.target, srcName, tgtName);
        updateView(result);
      } catch (err) {
        console.error('[Canvas] connect failed:', err);
        setToast({
          message: `Could not connect ${conn.source}.${srcName} → ${conn.target}.${tgtName}: ${(err as Error).message}`,
          type: 'error',
        });
        setTimeout(() => setToast(null), TOAST_INFO);
      }
    },
    [engine, updateView],
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

  // ── Open edge inspector when an existing edge is clicked ──
  const onEdgeClick = useCallback((_e: React.MouseEvent, edge: Edge) => {
    const sourceOutput = (edge.data?.source_output as string | undefined) ?? '';
    const targetInput = (edge.data?.target_input as string | undefined) ?? '';
    if (!sourceOutput || !targetInput) return;
    setSelectedEdge({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceOutput,
      targetInput,
    });
  }, []);

  // ── Delete the currently selected edge from the inspector ──
  const onDeleteSelectedEdge = useCallback(async () => {
    if (!engine || !selectedEdge) return;
    const result = await engine.disconnect(selectedEdge.target, selectedEdge.targetInput);
    updateView(result);
    setSelectedEdge(null);
  }, [engine, selectedEdge, updateView]);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      switch (msg.command) {
        case 'generateProgress': {
          setGenerating(true);
          setValidationErrors([]);
          setToast({ message: PHASE_LABELS[msg.phase as GeneratePhase], type: 'progress' });
          break;
        }
        case 'generateSuccess': {
          setGenerating(false);
          setValidationErrors([]);
          setErrorBannerDismissed(false);
          setToast({ message: 'Successfully generated', type: 'success' });
          setTimeout(() => setToast(null), TOAST_INFO);
          break;
        }
        case 'generateError': {
          setGenerating(false);
          const diags: Diagnostic[] = msg.diagnostics ?? [];
          setValidationErrors(diags);
          setErrorBannerDismissed(false);
          if (diags.length > 0) {
            setToast({ message: `Validation: ${diags.length} error(s)`, type: 'error' });
            setTimeout(() => setToast(null), TOAST_INFO);
          } else {
            setToast({ message: `Generate error: ${msg.message}`, type: 'error' });
            setTimeout(() => setToast(null), TOAST_INFO);
          }
          break;
        }
      }
    };

    window.addEventListener('hostMessage', handler);
    return () => window.removeEventListener('hostMessage', handler);
  }, []);

  // ── Derive errored node IDs from validation diagnostics ──
  const erroredNodeIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const d of validationErrors) {
      // Try address first: "module.cluster.aws_ecs_cluster.this" → "cluster"
      if (d.address) {
        const m = d.address.match(/^module\.([^.]+)/);
        if (m) {
          ids.add(m[1]);
          continue;
        }
      }
      // Fallback: file path "modules/cluster/main.tf" → "cluster"
      if (d.file) {
        const m = d.file.match(/(?:^|[\\/])modules[\\/]([^/\\]+)[\\/]/);
        if (m) ids.add(m[1]);
      }
    }
    return ids;
  }, [validationErrors]);

  // ── Solve with Lace: open chat with errors as context ──
  const onSolveWithLace = useCallback(() => {
    const lines = validationErrors.map((d) => {
      const loc = d.file ? ` (${d.file}${d.line != null ? `:${d.line}` : ''})` : '';
      return `- ${d.message}${loc}`;
    });
    const prompt = `@lace Fix these Terraform validation errors:\n${lines.join('\n')}\n\nFor any values you cannot determine from the canvas state or wired connections (e.g., DNS names, record types, resource names, AMI IDs), ask me — do not guess or use placeholder values.`;
    window.dispatchEvent(new CustomEvent('solveWithLace', { detail: { prompt } }));
  }, [validationErrors]);

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

      {/* Canvas context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1a1a1a] border border-[rgba(206,254,101,0.2)] rounded shadow-[0_4px_12px_rgba(0,0,0,0.5)] py-1"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: 120 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(
            [
              { label: 'Cut', shortcut: 'Ctrl+X', action: onCut },
              { label: 'Copy', shortcut: 'Ctrl+C', action: onCopy },
              { label: 'Paste', shortcut: 'Ctrl+V', action: onPaste },
            ] as { label: string; shortcut: string; action: () => void }[]
          ).map(({ label, shortcut, action }) => (
            <button
              key={label}
              className="w-full text-left px-3 py-1.5 text-xs text-[#CEFE65] hover:bg-[#153238] cursor-pointer flex items-center justify-between gap-4"
              style={{ background: 'transparent', border: 'none' }}
              onClick={() => action()}
            >
              <span>{label}</span>
              <span className="text-[#5a7060] text-[10px]">{shortcut}</span>
            </button>
          ))}
        </div>
      )}
      {/* Dismiss context menu on outside click */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setContextMenu(null);
            contextMenuNodeIdRef.current = null;
          }}
        />
      )}

      {/* Persistent validation error banner */}
      {!errorBannerDismissed && validationErrors.length > 0 && !toast && (
        <ValidationErrorBanner
          diagnostics={validationErrors}
          nodeIds={erroredNodeIds}
          onGoToNode={(nodeId) => goToNodeRef.current?.(nodeId)}
          onOpenFile={(relativePath, line, column) =>
            window.dispatchEvent(
              new CustomEvent('openFile', { detail: { relativePath, line, column } }),
            )
          }
          onSolveWithLace={onSolveWithLace}
          onDismiss={() => setErrorBannerDismissed(true)}
        />
      )}

      <div className="flex-1 relative min-h-0">
        <CompositeEditor
          view={view}
          isGenerating={generating}
          erroredNodeIds={erroredNodeIds}
          newNodeIds={newNodeIds}
          forcePositionsRef={forcePositionsRef}
          onDragStop={onDragStop}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onEdgesDelete={onEdgesDelete}
          onNodesDelete={onNodesDelete}
          onSave={onSave}
          onUndo={onUndo}
          onRedo={onRedo}
          onClearGraph={onClearGraph}
          onGenerate={onGenerate}
          onOpenSettings={onOpenSettings}
          registerGoToNode={registerGoToNode}
          registerZoomToNode={registerZoomToNode}
          registerGetSelectedIds={registerGetSelectedIds}
          registerSelectNodes={registerSelectNodes}
        />

        {/* Module config panel */}
        <SlidePanel open={!!configTarget}>
          {configTarget && (
            <ModuleConfigPanel
              instance_id={configTarget}
              engine={engine}
              onClose={() => setConfigTarget(null)}
              onModified={clearNew}
            />
          )}
        </SlidePanel>

        {/* Edge inspector */}
        <SlidePanel open={!!selectedEdge} zIndex={40}>
          {selectedEdge && (
            <EdgeInspectorPanel
              source={selectedEdge.source}
              target={selectedEdge.target}
              sourceOutput={selectedEdge.sourceOutput}
              targetInput={selectedEdge.targetInput}
              onDelete={onDeleteSelectedEdge}
              onClose={() => setSelectedEdge(null)}
            />
          )}
        </SlidePanel>

        {/* Unified settings panel */}
        <SlidePanel open={settingsOpen}>
          {settingsOpen && (
            <UnifiedSettingsPanel
              engine={engine}
              onClose={() => setSettingsOpen(false)}
              onSaved={() => {
                setToast({ message: 'Settings saved', type: 'success' });
                setTimeout(() => setToast(null), TOAST_BRIEF);
              }}
            />
          )}
        </SlidePanel>
      </div>
    </div>
  );
}
