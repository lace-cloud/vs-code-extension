import React, { useState, useCallback, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import ErrorBoundary from './components/ErrorBoundary';
import Canvas from './Canvas';
import { CanvasContext, type CanvasState } from './state/engine-context';
import type { CanvasEngine } from './engine';
import type { CanvasView, HostToWebview } from './types/render';
import { useWindowEvent } from './hooks/useWindowEvent';
import { CANVAS_EVENTS } from './events';

// VsCodeApi is the surface the webview uses to signal the host. In VS Code
// mode, `acquireVsCodeApi()` supplies the real one. In Storybook flow mode,
// FlowDecorator supplies a fake that routes signals to the engine directly,
// then re-dispatches host→webview messages via window.postMessage. This keeps
// App transport-agnostic: it only knows about an engine and a postMessage sink.
type VsCodeApi = { postMessage(msg: unknown): void };

type AppProps = {
  engine: CanvasEngine;
  vscode: VsCodeApi;
};

export default function App({ engine, vscode }: AppProps) {
  const [state, setState] = useState<CanvasState>({
    view: null,
    loading: true,
    error: null,
    generation: 0,
  });

  const updateView = useCallback((view: CanvasView) => {
    setState((prev) => ({ view, loading: false, error: null, generation: prev.generation + 1 }));
  }, []);

  // ── Host → webview: state + generate events ──
  // engineResult is NOT handled here — PostMessageEngine manages its own
  // listener for that, which keeps App agnostic of the concrete engine.
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

        case 'generateProgress':
        case 'generateSuccess':
        case 'generateError':
          window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.HOST_MESSAGE, { detail: msg }));
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

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
