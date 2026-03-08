import React from 'react';
import type { WorkspaceAction } from './reducer';

export type CanvasCallbacks = {
  openConfig: (instance_id: string) => void;
  markDirty: () => void;
  dispatch: (action: WorkspaceAction) => void;
  moduleKey: string;
  refreshModule: (moduleKey: string, id: string, version: string) => void;
  undo: () => void;
};

export const CanvasContext = React.createContext<CanvasCallbacks | null>(null);
