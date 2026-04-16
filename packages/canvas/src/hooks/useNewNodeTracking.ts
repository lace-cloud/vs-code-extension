import { useState, useCallback, useEffect, useRef } from 'react';
import type { CanvasView } from '../types/render';

export function useNewNodeTracking(view: CanvasView | null, zoomToNode: (id: string) => void) {
  const [newNodeIds, setNewNodeIds] = useState<Set<string>>(new Set());
  const prevNodeIdsRef = useRef<Set<string>>(new Set());
  const sessionLoadedRef = useRef(false);

  // Track newly added nodes
  useEffect(() => {
    if (!view) return;
    const currentIds = new Set(view.nodes.map((n) => n.id));

    if (!sessionLoadedRef.current) {
      sessionLoadedRef.current = true;
      prevNodeIdsRef.current = currentIds;
      return;
    }

    const prev = prevNodeIdsRef.current;
    const added = view.nodes.filter((n) => !prev.has(n.id)).map((n) => n.id);
    setNewNodeIds((s) => {
      const next = new Set([...s].filter((id) => currentIds.has(id)));
      for (const id of added) next.add(id);
      return next.size !== s.size || added.length > 0 ? next : s;
    });
    prevNodeIdsRef.current = currentIds;
  }, [view]);

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

  // Auto-zoom to last newly added node
  const latestNewNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (newNodeIds.size === 0) return;
    const ids = [...newNodeIds];
    const id = ids[ids.length - 1];
    if (id === latestNewNodeIdRef.current) return;
    latestNewNodeIdRef.current = id;
    const timer = setTimeout(() => zoomToNode(id), 150);
    return () => clearTimeout(timer);
  }, [newNodeIds, zoomToNode]);

  return { newNodeIds, clearNew };
}
