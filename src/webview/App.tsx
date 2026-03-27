import React, { useState, useCallback, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import ErrorBoundary from './components/ErrorBoundary';
import Canvas from './Canvas';
import { CanvasContext, type CanvasState } from './state/engine-context';
import { PostMessageEngine } from './post-message-engine';
import type { CanvasView } from './types/render';
import type { HostToWebview } from '../types/protocol';

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
          window.dispatchEvent(new CustomEvent('hostMessage', { detail: msg }));
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

  useEffect(() => {
    const handler = async () => {
      await engine.sessionSave();
    };
    window.addEventListener('canvasSave', handler);
    return () => window.removeEventListener('canvasSave', handler);
  }, [engine]);

  useEffect(() => {
    const handler = () => {
      vscode.postMessage({ command: 'generate' });
    };
    window.addEventListener('canvasGenerate', handler);
    return () => window.removeEventListener('canvasGenerate', handler);
  }, [vscode]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { prompt } = (e as CustomEvent).detail as { prompt: string };
      vscode.postMessage({ command: 'openChat', prompt });
    };
    window.addEventListener('solveWithLace', handler);
    return () => window.removeEventListener('solveWithLace', handler);
  }, [vscode]);

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
