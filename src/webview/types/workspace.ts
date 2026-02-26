import type { ModuleBundle } from './ir';

export type WorkspaceState = ModuleBundle & {
  layouts: Record<string, GraphLayout>; // keyed by module map key
};

export type GraphLayout = {
  nodes: Record<string, NodeLayout>; // keyed by instance id
};

export type NodeLayout = {
  position: { x: number; y: number };
};
