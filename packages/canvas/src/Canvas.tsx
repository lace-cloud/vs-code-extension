// src/webview/Canvas.tsx

import './Canvas.css';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MarkerType,
  MiniMap,
  type Node,
  type NodeChange,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ActionBar from './components/ActionBar';
import ContextMenu from './components/ContextMenu';
import { ErrorState } from './components/ErrorBoundary';
import GroupNode from './components/nodes/GroupNode';
import ModuleNode from './components/nodes/ModuleNode';
import EdgeInspectorPanel from './components/panels/EdgeInspectorPanel';
import ModuleConfigPanel from './components/panels/ModuleConfigPanel';
import UnifiedSettingsPanel from './components/panels/UnifiedSettingsPanel';
import SlidePanel from './components/SlidePanel';
import Toast from './components/Toast';
import { ValidationErrorBanner } from './components/ValidationErrorBanner';
import { CANVAS_EVENTS } from './events';
import { useClipboard } from './hooks/useClipboard';
import { useContextMenu } from './hooks/useContextMenu';
import { useEdgeInspector } from './hooks/useEdgeInspector';
import { useGenerationStatus } from './hooks/useGenerationStatus';
import { toAbsolutePositions, useGroupLogic } from './hooks/useGroupLogic';
import { useNewNodeTracking } from './hooks/useNewNodeTracking';
import { useToast } from './hooks/useToast';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useCanvas } from './state/engine-context';
import type { CanvasView, ViewportIntent } from './types/render';
import { parseHandleId } from './utils/handleId';

// ── Node types registration ──

const nodeTypes = {
  moduleNode: ModuleNode,
  groupNode: GroupNode,
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
  showMiniMap: boolean;
  onToggleMiniMap: () => void;
  registerGoToNode: (fn: (nodeId: string) => void) => void;
  registerGetSelectedIds: (fn: () => string[]) => void;
  registerSelectNodes: (fn: (ids: string[]) => void) => void;
  viewportIntent: ViewportIntent | null;
  viewportIntentSeq: number;
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
  showMiniMap,
  onToggleMiniMap,
  registerGoToNode,
  registerGetSelectedIds,
  registerSelectNodes,
  viewportIntent,
  viewportIntentSeq,
}: CompositeEditorProps) {
  const { fitView, fitBounds, getNode } = useReactFlow();

  // ── Selection tracking ──
  const selectedIdsRef = useRef<string[]>([]);
  const pendingSelectIdsRef = useRef<string[] | null>(null);

  // One-time fit on mount
  useEffect(() => {
    if (view.nodes.length > 0) {
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    }
  }, []);

  // Register go-to-node handler
  useEffect(() => {
    registerGoToNode((nodeId: string) => {
      const n = getNode(nodeId);
      if (!n) return;
      fitBounds(
        {
          x: n.position.x,
          y: n.position.y,
          width: n.measured?.width ?? 240,
          height: n.measured?.height ?? 160,
        },
        { padding: 1.2, duration: 300 },
      );
      window.dispatchEvent(
        new CustomEvent(CANVAS_EVENTS.OPEN_NODE_CONFIG, { detail: { instanceId: nodeId } }),
      );
    });
  }, []);

  useEffect(() => {
    if (!viewportIntent) return;

    requestAnimationFrame(() => {
      if (viewportIntent.kind === 'fit-all') {
        if (view.nodes.length > 0) {
          fitView({
            padding: viewportIntent.padding ?? 0.2,
            duration: viewportIntent.duration ?? 300,
          });
        }
        return;
      }

      const n = getNode(viewportIntent.nodeId);
      if (!n) return;
      fitBounds(
        {
          x: n.position.x,
          y: n.position.y,
          width: n.measured?.width ?? 240,
          height: n.measured?.height ?? 160,
        },
        {
          padding: viewportIntent.padding ?? 1.2,
          duration: viewportIntent.duration ?? 300,
        },
      );
    });
  }, [fitBounds, fitView, getNode, view.nodes.length, viewportIntent, viewportIntentSeq]);

  // ── Nodes + Edges (group-aware) ──
  const groupLogic = useGroupLogic(view.nodes, view.edges, view.groups, newNodeIds, erroredNodeIds);

  const rfEdgesFromView = groupLogic.rfEdges;

  const [rfEdges, setRfEdges] = useState<Edge[]>(rfEdgesFromView);
  useEffect(() => {
    setRfEdges(rfEdgesFromView);
  }, [rfEdgesFromView]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges((prev) => applyEdgeChanges(changes, prev));
  }, []);

  const rfNodesFromView = groupLogic.rfNodes;

  const [rfNodes, setRfNodes] = useState<Node[]>(rfNodesFromView);

  // Track group membership to detect when coordinate spaces change
  const prevGroupKeyRef = useRef('');

  useEffect(() => {
    const force = forcePositionsRef.current;
    forcePositionsRef.current = false;
    const pending = pendingSelectIdsRef.current;
    pendingSelectIdsRef.current = null;

    // Force positions when group membership changes (parentId shifts coordinate space)
    const groups = view.groups;
    const groupKey = groups.map((g) => `${g.id}:${g.collapsed}:${g.node_ids.join(',')}`).join('|');
    const groupsChanged = groupKey !== prevGroupKeyRef.current;
    prevGroupKeyRef.current = groupKey;

    setRfNodes((prev) => {
      if (force || groupsChanged) return rfNodesFromView;
      return rfNodesFromView.map((n) => {
        const existing = prev.find((p) => p.id === n.id);
        const selected = pending?.includes(n.id) ?? existing?.selected ?? false;
        return {
          ...n,
          position: existing?.position ?? n.position,
          selected,
        };
      });
    });
  }, [rfNodesFromView, forcePositionsRef, view.groups]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((prev) => {
      const next = applyNodeChanges(changes, prev);
      selectedIdsRef.current = next.filter((n) => n.selected).map((n) => n.id);
      return next;
    });
  }, []);

  useEffect(() => {
    registerGetSelectedIds(() => selectedIdsRef.current);
  }, []);

  useEffect(() => {
    registerSelectNodes((ids: string[]) => {
      pendingSelectIdsRef.current = ids;
    });
  }, []);

  const onNodeDragStop = useCallback(
    (_e: React.MouseEvent, draggedNode: Node, draggedNodes: Node[]) => {
      const positions = toAbsolutePositions(draggedNode, draggedNodes, rfNodes, view.groups);
      if (Object.keys(positions).length > 0) {
        onDragStop(positions);
      }
    },
    [onDragStop, rfNodes, view.groups],
  );

  // ── Grid + edge defaults ──
  // Colors reference design tokens via CSS custom properties. Both React
  // inline `style` and SVG fill/stroke attributes resolve `var(--...)`
  // at render time, so tokens drive the actual color without a JS round-trip.
  const gridColor = 'var(--lace-canvas-grid-dot)';
  const defaultEdgeOptions = {
    style: { stroke: 'var(--lace-canvas-edge-stroke)', strokeWidth: 1.5 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: 'var(--lace-canvas-edge-stroke)',
      width: 14,
      height: 14,
    },
    animated: false,
  };

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      onEdgesDelete={onEdgesDelete}
      onNodesDelete={onNodesDelete}
      onNodeDragStop={onNodeDragStop}
      onNodeContextMenu={(e, node) => {
        e.preventDefault();
        const selCount = selectedIdsRef.current.length;
        window.dispatchEvent(
          new CustomEvent(CANVAS_EVENTS.CONTEXT_MENU, {
            detail: {
              instanceId: node.type === 'groupNode' ? null : node.id,
              groupId: node.type === 'groupNode' ? node.id : null,
              selectedCount: selCount,
              x: e.clientX,
              y: e.clientY,
            },
          }),
        );
      }}
      onPaneContextMenu={(e) => {
        e.preventDefault();
        const selCount = selectedIdsRef.current.length;
        window.dispatchEvent(
          new CustomEvent(CANVAS_EVENTS.CONTEXT_MENU, {
            detail: {
              instanceId: null,
              groupId: null,
              selectedCount: selCount,
              x: e.clientX,
              y: e.clientY,
            },
          }),
        );
      }}
      defaultEdgeOptions={defaultEdgeOptions}
      connectionRadius={30}
      minZoom={0.15}
      maxZoom={2}
      deleteKeyCode={['Backspace', 'Delete']}
      fitView={false}
      proOptions={{ hideAttribution: true }}
      style={{ background: 'var(--lace-color-bg-canvas)' }}
    >
      {/* Opposite-corner overlay layout:
          - MiniMap bottom-left (standalone; toggleable via ActionBar below).
          - Controls bottom-right (always available, detached from minimap).
          Inline offsets use xyflow's first-class positioning API and
          behave identically in the webview and Storybook. Colors flow
          through design tokens. */}
      {showMiniMap ? (
        <MiniMap
          position="bottom-left"
          style={{
            width: 140,
            height: 100,
            background: 'var(--lace-canvas-minimap-bg)',
            bottom: 20,
            left: 20,
          }}
          maskColor="var(--lace-canvas-minimap-mask)"
          nodeColor="var(--lace-color-accent)"
        />
      ) : null}
      <Controls position="bottom-right" showInteractive={false} style={{ bottom: 20, right: 20 }} />
      <ActionBar
        isGenerating={isGenerating}
        onSave={onSave}
        onUndo={onUndo}
        onRedo={onRedo}
        onClearGraph={onClearGraph}
        onGenerate={onGenerate}
        onOpenSettings={onOpenSettings}
        showMiniMap={showMiniMap}
        onToggleMiniMap={onToggleMiniMap}
      />
      <svg>
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.5" fill={gridColor} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Default off: canvases at our scale (<15 nodes) don't need the
  // overview; MiniMap is chrome tax. Users opt in via the ActionBar
  // toggle. Matches VS Code's own "Toggle MiniMap" pattern.
  const [showMiniMap, setShowMiniMap] = useState(false);
  const toggleMiniMap = useCallback(() => setShowMiniMap((v) => !v), []);

  // ── Hooks ──
  const { toast, showToast } = useToast();
  const { contextMenu, dismissContextMenu } = useContextMenu();
  const { forcePositionsRef, onUndo, onRedo } = useUndoRedo(
    engine,
    !!state.view?.can_undo,
    !!state.view?.can_redo,
    updateView,
  );
  const { selectedEdge, onEdgeClick, onDeleteSelectedEdge, clearSelectedEdge } = useEdgeInspector(
    engine,
    updateView,
  );
  const { generating, validationErrors, erroredNodeIds, errorBannerDismissed, dismissErrorBanner } =
    useGenerationStatus(showToast);

  const { newNodeIds, clearNew } = useNewNodeTracking(state.view);

  // Stable ref for go-to-node — set by CompositeEditor
  const goToNodeRef = useRef<((nodeId: string) => void) | null>(null);
  const registerGoToNode = useCallback((fn: (nodeId: string) => void) => {
    goToNodeRef.current = fn;
  }, []);

  // Stable ref for reading/setting selected node IDs — set by CompositeEditor
  const getSelectedIdsRef = useRef<(() => string[]) | null>(null);
  const registerGetSelectedIds = useCallback((fn: () => string[]) => {
    getSelectedIdsRef.current = fn;
  }, []);

  const selectNodesRef = useRef<((ids: string[]) => void) | null>(null);
  const registerSelectNodes = useCallback((fn: (ids: string[]) => void) => {
    selectNodesRef.current = fn;
  }, []);

  const { onCopy, onCut, onPaste } = useClipboard(
    engine,
    updateView,
    state.view,
    showToast,
    useCallback(() => getSelectedIdsRef.current?.() ?? [], []),
    useCallback((ids: string[]) => selectNodesRef.current?.(ids), []),
    useCallback(() => contextMenu?.nodeId ?? null, [contextMenu]),
    dismissContextMenu,
  );

  // ── Listen for openNodeConfig events from ModuleNode ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.instanceId) setConfigTarget(detail.instanceId);
    };
    window.addEventListener(CANVAS_EVENTS.OPEN_NODE_CONFIG, handler);
    return () => window.removeEventListener(CANVAS_EVENTS.OPEN_NODE_CONFIG, handler);
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
    window.addEventListener(CANVAS_EVENTS.VIEW_UPDATED, handler);
    return () => window.removeEventListener(CANVAS_EVENTS.VIEW_UPDATED, handler);
  }, [updateView]);

  // ── Save via engine ──
  const onSave = useCallback(async () => {
    if (!engine) return;
    await engine.sessionSave();
    showToast('Saved', 'success');
  }, [engine, showToast]);

  // ── Generate via host ──
  const onGenerate = useCallback(() => {
    window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.GENERATE));
  }, []);

  // ── Expose undo globally for HTML-level Cmd+Z listener ──
  useEffect(() => {
    window.__canvasUndo = onUndo;
    return () => {
      window.__canvasUndo = undefined;
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

      const srcName = parseHandleId(conn.sourceHandle, 'out');
      const tgtName = parseHandleId(conn.targetHandle, 'in');
      if (!srcName || !tgtName) {
        try {
          const result = await engine.autoConnect(conn.source, conn.target);
          updateView(result);
        } catch (err) {
          console.error('[Canvas] autoConnect fallback failed:', err);
        }
        return;
      }

      const alreadyWired = (viewRef.current?.edges ?? []).some(
        (e) => e.target === conn.target && e.target_input === tgtName,
      );
      if (alreadyWired) {
        showToast(
          `${conn.target}.${tgtName} is already wired \u2014 delete the existing connection first.`,
          'error',
        );
        return;
      }

      try {
        const result = await engine.connect(conn.source, conn.target, srcName, tgtName);
        updateView(result);
      } catch (err) {
        console.error('[Canvas] connect failed:', err);
        showToast(
          `Could not connect ${conn.source}.${srcName} \u2192 ${conn.target}.${tgtName}: ${(err as Error).message}`,
          'error',
        );
      }
    },
    [engine, updateView, showToast],
  );

  // ── Event: edge delete ──
  const onEdgesDelete = useCallback(
    async (edges: Edge[]) => {
      if (!engine) return;
      for (const edge of edges) {
        const targetInput = edge.data?.target_input as string | undefined;
        // Use original target for remapped edges (collapsed groups)
        const target = (edge.data?.original_target as string) ?? edge.target;
        if (targetInput) {
          const result = await engine.disconnect(target, targetInput);
          updateView(result);
        }
      }
    },
    [engine, updateView],
  );

  // ── Event: node delete ──
  const onNodesDelete = useCallback(
    async (nodes: Node[]) => {
      if (!engine) return;
      for (const node of nodes) {
        if (node.type === 'groupNode') {
          // Delete on a group node → ungroup (remove container, keep instances)
          const result = await engine.deleteGroup(node.id);
          updateView(result);
        } else {
          const result = await engine.deleteInstance(node.id);
          updateView(result);
        }
      }
    },
    [engine, updateView],
  );

  // ── Event: clear all ──
  const onClearGraph = useCallback(async () => {
    if (!engine || !state.view) return;
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

  // ── Group actions ──
  const onGroupSelected = useCallback(async () => {
    const ids = getSelectedIdsRef.current?.() ?? [];
    if (ids.length < 2 || !engine) return;
    try {
      const label = `Group ${ids.length}`;
      const result = await engine.createGroup(label, ids);
      updateView(result);
      dismissContextMenu();
    } catch (err) {
      showToast(`Failed to create group: ${(err as Error).message}`, 'error');
    }
  }, [engine, updateView, dismissContextMenu, showToast]);

  const onUngroup = useCallback(
    async (groupId: string) => {
      if (!engine) return;
      try {
        const result = await engine.deleteGroup(groupId);
        updateView(result);
        dismissContextMenu();
      } catch (err) {
        showToast(`Failed to ungroup: ${(err as Error).message}`, 'error');
      }
    },
    [engine, updateView, dismissContextMenu, showToast],
  );

  // ── Guard: need a view to render ──
  if (state.loading || !state.view) {
    if (state.error) {
      return <ErrorState message={state.error} />;
    }
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--lace-text-muted)',
          fontSize: 13,
        }}
      >
        Loading canvas...
      </div>
    );
  }

  if (!engine) {
    return <ErrorState message="Engine not available." />;
  }

  const view = state.view;

  // ── Render ──
  // Inline layout instead of Tailwind utilities so this works in Storybook
  // (Tailwind v4 only scans canvas-stories, not @lace/canvas). Children
  // rely on the outer 100vh height to place xyflow's bottom-docked panels
  // correctly — without it the ReactFlow container collapses.
  return (
    <div
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100vh' }}
    >
      <Toast toast={toast} />
      <ContextMenu
        contextMenu={contextMenu}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onGroupSelected={onGroupSelected}
        onUngroup={onUngroup}
        onDismiss={dismissContextMenu}
      />

      {/* Persistent validation error banner */}
      {!errorBannerDismissed && validationErrors.length > 0 && !toast && (
        <ValidationErrorBanner
          diagnostics={validationErrors}
          nodeIds={erroredNodeIds}
          onGoToNode={(nodeId) => goToNodeRef.current?.(nodeId)}
          onOpenFile={(relativePath, line, column) =>
            window.dispatchEvent(
              new CustomEvent(CANVAS_EVENTS.OPEN_FILE, { detail: { relativePath, line, column } }),
            )
          }
          onDismiss={dismissErrorBanner}
        />
      )}

      <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0 }}>
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
          showMiniMap={showMiniMap}
          onToggleMiniMap={toggleMiniMap}
          registerGoToNode={registerGoToNode}
          registerGetSelectedIds={registerGetSelectedIds}
          registerSelectNodes={registerSelectNodes}
          viewportIntent={state.viewportIntent}
          viewportIntentSeq={state.viewportIntentSeq}
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
              onClose={clearSelectedEdge}
            />
          )}
        </SlidePanel>

        {/* Unified settings panel */}
        <SlidePanel open={settingsOpen}>
          {settingsOpen && (
            <UnifiedSettingsPanel
              engine={engine}
              onClose={() => setSettingsOpen(false)}
              onSaved={() => showToast('Settings saved', 'success')}
            />
          )}
        </SlidePanel>
      </div>
    </div>
  );
}
