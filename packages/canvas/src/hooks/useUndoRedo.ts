import { useCallback, useRef } from 'react';
import type { CanvasEngine } from '../engine';
import type { CanvasView } from '../types/render';

export function useUndoRedo(
  engine: CanvasEngine | null,
  canUndo: boolean,
  canRedo: boolean,
  updateView: (view: CanvasView) => void,
) {
  const forcePositionsRef = useRef(false);

  const onUndo = useCallback(async () => {
    if (!engine || !canUndo) return;
    forcePositionsRef.current = true;
    const result = await engine.undo();
    updateView(result);
  }, [engine, canUndo, updateView]);

  const onRedo = useCallback(async () => {
    if (!engine || !canRedo) return;
    forcePositionsRef.current = true;
    const result = await engine.redo();
    updateView(result);
  }, [engine, canRedo, updateView]);

  return { forcePositionsRef, onUndo, onRedo };
}
