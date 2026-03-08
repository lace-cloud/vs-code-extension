import type { Bundle } from './ir';

export type WorkspaceState = Bundle & {
  layouts: Record<string, GraphLayout>; // keyed by module map key
};

export type GraphLayout = {
  nodes: Record<string, NodeLayout>; // keyed by instance id
};

export type NodeLayout = {
  position: { x: number; y: number };
};
