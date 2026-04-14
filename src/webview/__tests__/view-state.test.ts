import { describe, expect, test } from 'vitest';

import type { CanvasView } from '../types/render';
import { applyPositionsToCanvasView } from '../utils/view-state';

const VIEW: CanvasView = {
  module_name: 'workspace',
  nodes: [
    {
      id: 'role',
      label: 'role',
      kind: 'module',
      position: { x: 100, y: 100 },
      has_errors: false,
      error_messages: [],
      inputs: [],
      outputs: [],
    },
    {
      id: 'policy',
      label: 'policy',
      kind: 'module',
      position: { x: 200, y: 100 },
      has_errors: false,
      error_messages: [],
      inputs: [],
      outputs: [],
    },
  ],
  edges: [],
  errors: [],
  can_undo: false,
  can_redo: false,
  is_dirty: false,
  groups: [],
};

describe('applyPositionsToCanvasView', () => {
  test('updates only the nodes present in the sync layout payload', () => {
    const next = applyPositionsToCanvasView(VIEW, {
      policy: { x: 444, y: 222 },
    });

    expect(next.nodes).toEqual([
      expect.objectContaining({ id: 'role', position: { x: 100, y: 100 } }),
      expect.objectContaining({ id: 'policy', position: { x: 444, y: 222 } }),
    ]);
  });
});
