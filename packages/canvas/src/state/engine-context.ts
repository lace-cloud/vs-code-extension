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
});

export function useCanvas(): CanvasContextValue {
  return useContext(CanvasContext);
}

export function useEngine(): CanvasEngine {
  const { engine } = useCanvas();
  if (!engine) throw new Error('CanvasEngine not available');
  return engine;
}
