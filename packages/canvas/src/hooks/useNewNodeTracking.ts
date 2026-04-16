import { useState, useCallback, useEffect, useRef } from 'react';
import type { CanvasView } from '../types/render';

export function useNewNodeTracking(view: CanvasView | null) {
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

  return { newNodeIds, clearNew };
}
