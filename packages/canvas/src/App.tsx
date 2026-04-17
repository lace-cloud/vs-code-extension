import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useState } from 'react';
import Canvas from './Canvas';
import ErrorBoundary from './components/ErrorBoundary';
import type { CanvasEngine } from './engine';
import { CANVAS_EVENTS } from './events';
import { useWindowEvent } from './hooks/useWindowEvent';
import { CanvasContext, type CanvasState } from './state/engine-context';
import type { CanvasView } from './types/render';

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
  /**
   * When true, the canvas renders in read-only mode: pan/zoom/drag/inspect
   * still work, but every IR-mutating affordance (save, delete, rename,
   * wire, generate) is hidden or blocked. Defaults to `false`.
   */
  readOnly?: boolean;
};

export default function App({ engine, hostBridge, readOnly = false }: AppProps) {
  const [state, setState] = useState<CanvasState>({
    view: null,
    loading: true,
    error: null,
    generation: 0,
    viewportIntent: null,
    viewportIntentSeq: 0,
  });

  // Read-only local collapse overrides. Untouched when readOnly=false
  // (editable canvas persists collapse via engine.updateGroup instead).
  const [localGroupCollapseOverrides, setLocalGroupCollapseOverrides] = useState<
    Record<string, boolean>
  >({});
  const toggleLocalGroupCollapse = useCallback((groupId: string, currentCollapsed: boolean) => {
    setLocalGroupCollapseOverrides((prev) => ({ ...prev, [groupId]: !currentCollapsed }));
  }, []);

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

  // SAVE / GENERATE are host-dispatched mutations. In read-only we
  // don't install listeners — so if the host accidentally dispatches
  // them, the canvas is silent. Gating at the install site (rather
  // than inside the handler) keeps read-only mode a structural
  // property, not a runtime check.
  useWindowEvent(CANVAS_EVENTS.SAVE, () => engine.sessionSave(), [engine], { enabled: !readOnly });

  useWindowEvent(CANVAS_EVENTS.GENERATE, () => hostBridge.triggerGenerate(), [hostBridge], {
    enabled: !readOnly,
  });

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
      <CanvasContext.Provider
        value={{
          state,
          engine,
          updateView,
          readOnly,
          localGroupCollapseOverrides,
          toggleLocalGroupCollapse,
        }}
      >
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
      </CanvasContext.Provider>
    </ErrorBoundary>
  );
}
