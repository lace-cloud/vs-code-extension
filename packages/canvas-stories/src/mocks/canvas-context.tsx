import type { CanvasEngine } from '@lace/canvas/engine';
import { CanvasContext } from '@lace/canvas/state/engine-context';
import type { CanvasView } from '@lace/canvas/types/render';
import type { ReactNode } from 'react';

/**
 * No-op engine stub for stories. Methods reject if called so accidental
 * dispatch from a useEffect fails loudly rather than silently returning
 * fake success. Stories verify render-only; any component that actually
 * calls the engine on mount is a Phase E2 concern (flow stories).
 */
function rejectUnavailable(): Promise<never> {
  return Promise.reject(new Error('Engine not available in component story context'));
}

const noopEngine: CanvasEngine = {
  sessionOpen: rejectUnavailable,
  sessionSave: rejectUnavailable,
  sessionClose: rejectUnavailable,
  sessionGenerate: rejectUnavailable,
  connect: rejectUnavailable,
  autoConnect: rejectUnavailable,
  disconnect: rejectUnavailable,
  updateInput: rejectUnavailable,
  updateAllInputs: rejectUnavailable,
  renameInstance: rejectUnavailable,
  deleteInstance: rejectUnavailable,
  copyInstances: rejectUnavailable,
  syncLayout: rejectUnavailable,
  setVariables: rejectUnavailable,
  setExports: rejectUnavailable,
  setTerraform: rejectUnavailable,
  setProviders: rejectUnavailable,
  setLocals: rejectUnavailable,
  setDependsOn: rejectUnavailable,
  setEnvironments: rejectUnavailable,
  undo: rejectUnavailable,
  redo: rejectUnavailable,
  createGroup: rejectUnavailable,
  updateGroup: rejectUnavailable,
  deleteGroup: rejectUnavailable,
  queryNodeConfig: rejectUnavailable,
  queryEdgeConfig: rejectUnavailable,
  querySettings: rejectUnavailable,
  queryGraphSummary: rejectUnavailable,
  queryValidate: rejectUnavailable,
};

type Props = {
  children: ReactNode;
  view?: CanvasView | null;
  readOnly?: boolean;
};

export function MockCanvasContext({ children, view = null, readOnly = false }: Props) {
  return (
    <CanvasContext.Provider
      value={{
        state: {
          view,
          loading: false,
          error: null,
          generation: 0,
          viewportIntent: null,
          viewportIntentSeq: 0,
        },
        engine: noopEngine,
        updateView: () => {},
        readOnly,
        localGroupCollapseOverrides: {},
        toggleLocalGroupCollapse: () => {},
      }}
    >
      {children}
    </CanvasContext.Provider>
  );
}
