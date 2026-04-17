import { createContext, useContext } from 'react';
import type { CanvasEngine } from '../engine';
import type { CanvasView, ViewportIntent } from '../types/render';

export type CanvasState = {
  view: CanvasView | null;
  loading: boolean;
  error: string | null;
  generation: number;
  viewportIntent: ViewportIntent | null;
  viewportIntentSeq: number;
};

export type CanvasContextValue = {
  state: CanvasState;
  engine: CanvasEngine | null;
  updateView: (view: CanvasView) => void;
  // Read-only mode. In read-only, view-only interactions (drag,
  // expand/collapse, inspection) remain; IR mutations (delete,
  // rename, wire, save) are gated off.
  readOnly: boolean;
  // In read-only we let users expand/collapse groups as a view op,
  // but must not persist it via engine.updateGroup. We stash the
  // override at the provider level so useGroupLogic (which drives
  // xyflow's child-node hiding) can read the effective collapsed
  // flag from a single source of truth.
  localGroupCollapseOverrides: Record<string, boolean>;
  toggleLocalGroupCollapse: (groupId: string, currentCollapsed: boolean) => void;
};

export const CanvasContext = createContext<CanvasContextValue>({
  state: {
    view: null,
    loading: true,
    error: null,
    generation: 0,
    viewportIntent: null,
    viewportIntentSeq: 0,
  },
  engine: null,
  updateView: () => {},
  readOnly: false,
  localGroupCollapseOverrides: {},
  toggleLocalGroupCollapse: () => {},
});

export function useCanvas(): CanvasContextValue {
  return useContext(CanvasContext);
}

export function useEngine(): CanvasEngine {
  const { engine } = useCanvas();
  if (!engine) throw new Error('CanvasEngine not available');
  return engine;
}
