import { App, type HostBridge } from '@lace/canvas';
import type { CanvasView } from '@lace/proto';
import { useMemo } from 'react';
import { MockCanvasEngine } from '../mocks/mock-engine';

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
};

/**
 * Mounts the full Canvas App against an in-memory {@link MockCanvasEngine}.
 * No CLI, no network — render paths execute against committed fixtures
 * captured by `scripts/capture-fixtures.mjs`. Stories using this decorator
 * snapshot in Chromatic's cloud without any backend.
 */
export function MockFlowDecorator({ fixture }: Props) {
  const engine = useMemo(() => new MockCanvasEngine(fixture), [fixture]);
  const hostBridge = useMemo(() => makeMockBridge(engine), [engine]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <App engine={engine} hostBridge={hostBridge} />
    </div>
  );
}
