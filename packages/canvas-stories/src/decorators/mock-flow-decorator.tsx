import { App, type HostBridge } from '@lace/canvas';
import type { CanvasView } from '@lace/proto';
import { useEffect, useMemo } from 'react';
import { MockCanvasEngine, type MockEngineOptions } from '../mocks/mock-engine';

// Noop bridge — mock flow stories are static snapshots, so host signals
// have nothing to drive. `triggerGenerate` routes through the engine's
// own sessionGenerate path, which emits the progress/success events.
function makeMockBridge(engine: MockCanvasEngine): HostBridge {
  return {
    signalReady: () => {},
    markDirty: () => {},
    markClean: () => {},
    triggerGenerate: () => {
      void engine.sessionGenerate();
    },
    openFile: () => {},
  };
}

type Props = {
  fixture: CanvasView;
  /**
   * Extra MockCanvasEngine options. Scene + panel stories that need
   * realistic `queryNodeConfig` / `querySettings` / `queryEdgeConfig`
   * responses pass fixtures here.
   */
  engineOptions?: MockEngineOptions;
  /**
   * Optional hook scene stories use to pin the canvas into a specific
   * UI state after the initial view mounts — e.g. fire a synthetic
   * `generateSuccess` to make the save toast appear. Runs on the
   * microtask after mount so subscriptions have landed.
   */
  onReady?: (engine: MockCanvasEngine) => void;
  /**
   * Forwards to `<App readOnly>`. Scene stories for read-only mode
   * use this to mount the canvas with every IR-mutating affordance
   * hidden or gated off.
   */
  readOnly?: boolean;
};

/**
 * Mounts the full Canvas App against an in-memory {@link MockCanvasEngine}.
 * No CLI, no network — render paths execute against committed fixtures
 * captured by `scripts/capture-fixtures.mjs`. Stories using this decorator
 * snapshot in Chromatic's cloud without any backend.
 */
export function MockFlowDecorator({ fixture, engineOptions, onReady, readOnly }: Props) {
  const engine = useMemo(
    () => new MockCanvasEngine(fixture, engineOptions),
    [fixture, engineOptions],
  );
  const hostBridge = useMemo(() => makeMockBridge(engine), [engine]);

  useEffect(() => {
    if (!onReady) return;
    // Deferred past the stateUpdated microtask so listeners have seen
    // the initial view before we start injecting state transitions.
    const timer = setTimeout(() => onReady(engine), 0);
    return () => clearTimeout(timer);
  }, [engine, onReady]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <App engine={engine} hostBridge={hostBridge} readOnly={readOnly} />
    </div>
  );
}
