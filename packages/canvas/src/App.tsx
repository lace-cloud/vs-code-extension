import React, { useState, useCallback, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import ErrorBoundary from './components/ErrorBoundary';
import Canvas from './Canvas';
import { CanvasContext, type CanvasState } from './state/engine-context';
import { PostMessageEngine } from './post-message-engine';
import type { CanvasView, HostToWebview } from './types/render';
import { useWindowEvent } from './hooks/useWindowEvent';
import { CANVAS_EVENTS } from './events';

type VsCodeApi = { postMessage(msg: unknown): void };

type AppProps = {
  vscode: VsCodeApi;
};

export default function App({ vscode }: AppProps) {
  const [state, setState] = useState<CanvasState>({
    view: null,
    loading: true,
    error: null,
    generation: 0,
  });

  const [engine] = useState(() => new PostMessageEngine(vscode));

  const updateView = useCallback((view: CanvasView) => {
    setState((prev) => ({ view, loading: false, error: null, generation: prev.generation + 1 }));
  }, []);

  // ── Central message listener: host → webview ──
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data as HostToWebview;

      switch (msg.command) {
        case 'loadState':
          setState((prev) => ({
            view: msg.state,
            loading: false,
            error: null,
            generation: prev.generation + 1,
          }));
          break;

        case 'engineResult':
          engine.handleResult(msg.requestId, msg.result, msg.error);
          break;

        case 'generateProgress':
        case 'generateSuccess':
        case 'generateError':
          window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.HOST_MESSAGE, { detail: msg }));
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [engine]);

  useEffect(() => {
    if (state.view === null) return;
    vscode.postMessage({ command: state.view.is_dirty ? 'markDirty' : 'markClean' });
  }, [state.view?.is_dirty, vscode]);

  useWindowEvent(CANVAS_EVENTS.SAVE, () => engine.sessionSave(), [engine]);

  useWindowEvent(CANVAS_EVENTS.GENERATE, () => vscode.postMessage({ command: 'generate' }), [
    vscode,
  ]);

  useWindowEvent(
    CANVAS_EVENTS.OPEN_FILE,
    (e) => {
      const { relativePath, line, column } = (e as CustomEvent).detail as {
        relativePath: string;
        line?: number;
        column?: number;
      };
      vscode.postMessage({ command: 'openFile', relativePath, line, column });
    },
    [vscode],
  );

  // ── Signal readiness to host ──
  useEffect(() => {
    vscode.postMessage({ command: 'webviewReady' });
  }, [vscode]);

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
