import React, { useState, useCallback, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import ErrorBoundary from './components/ErrorBoundary';
import Canvas from './Canvas';
import { CanvasContext, type CanvasState } from './state/engine-context';
import type { CanvasEngine } from './engine';
import type { CanvasView } from './types/render';
import { useWindowEvent } from './hooks/useWindowEvent';
import { CANVAS_EVENTS } from './events';

/**
 * HostBridge is the narrow, typed surface for outbound signals to whatever is
 * hosting the canvas. In VS Code mode this wraps `acquireVsCodeApi()`; in
 * Storybook flow mode the decorator supplies a bridge that routes signals to
 * the engine directly (e.g. triggerGenerate → engine.sessionGenerate).
 */
export type HostBridge = {
  signalReady(): void;
  markDirty(): void;
  markClean(): void;
  triggerGenerate(): void;
  openFile(relativePath: string, line?: number, column?: number): void;
};

type AppProps = {
  engine: CanvasEngine;
  hostBridge: HostBridge;
};

export default function App({ engine, hostBridge }: AppProps) {
  const [state, setState] = useState<CanvasState>({
    view: null,
    loading: true,
    error: null,
    generation: 0,
    viewportIntent: null,
    viewportIntentSeq: 0,
  });

  const updateView = useCallback((view: CanvasView) => {
    setState((prev) => ({
      ...prev,
      view,
      loading: false,
      error: null,
      generation: prev.generation + 1,
    }));
  }, []);

  // ── Engine events → state updates ──
  // Both PostMessageEngine and ConnectWebEngine emit the same EngineEvent
  // shape through onEvent. Generate* events flow through hooks (useEngine)
  // so App stays engine-agnostic.
  useEffect(() => {
    return engine.onEvent((event) => {
      if (event.type === 'stateUpdated') {
        setState((prev) => ({
          view: event.view,
          loading: false,
          error: null,
          generation: prev.generation + 1,
          viewportIntent: event.viewportIntent ?? null,
          viewportIntentSeq: prev.viewportIntentSeq + (event.viewportIntent ? 1 : 0),
        }));
      }
    });
  }, [engine]);

  useEffect(() => {
    if (state.view === null) return;
    if (state.view.is_dirty) hostBridge.markDirty();
    else hostBridge.markClean();
  }, [state.view?.is_dirty, hostBridge]);

  useWindowEvent(CANVAS_EVENTS.SAVE, () => engine.sessionSave(), [engine]);

  useWindowEvent(CANVAS_EVENTS.GENERATE, () => hostBridge.triggerGenerate(), [hostBridge]);

  useWindowEvent(
    CANVAS_EVENTS.OPEN_FILE,
    (e) => {
      const { relativePath, line, column } = (e as CustomEvent).detail as {
        relativePath: string;
        line?: number;
        column?: number;
      };
      hostBridge.openFile(relativePath, line, column);
    },
    [hostBridge],
  );

  // ── Signal readiness to host ──
  useEffect(() => {
    hostBridge.signalReady();
  }, [hostBridge]);

  return (
    <ErrorBoundary>
      <CanvasContext.Provider value={{ state, engine, updateView }}>
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
      </CanvasContext.Provider>
    </ErrorBoundary>
  );
}
