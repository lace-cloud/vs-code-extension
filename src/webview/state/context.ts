import React from 'react';

export type CanvasCallbacks = {
  openConfig: (instance_id: string) => void;
  markDirty: () => void;
};

export const CanvasContext = React.createContext<CanvasCallbacks | null>(null);
