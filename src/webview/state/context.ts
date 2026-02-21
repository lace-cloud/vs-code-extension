// ── CanvasCallbacks ──
//
// Type-only export for Phase 1A. The actual React.createContext call
// is deferred to Phase 1B to keep this phase free of React imports.

export type CanvasCallbacks = {
  openConfig: (instance_id: string) => void;
  navigateIn: (instance_id: string) => void;
  markDirty: () => void;
};
