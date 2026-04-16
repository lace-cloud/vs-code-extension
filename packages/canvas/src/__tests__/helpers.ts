import type { CanvasView, NodePin, RenderEdge, RenderNode } from '../types/render';

// ── CanvasView builders for tests ──

/**
 * Build a CanvasView with the given nodes/edges for testing.
 */
export function makeCanvasView(nodes: RenderNode[] = [], edges: RenderEdge[] = []): CanvasView {
  return {
    module_name: 'root',
    nodes,
    edges,
    errors: [],
    can_undo: false,
    can_redo: false,
    is_dirty: false,
    groups: [],
  };
}

// ── Common node builders ──

export function makeNode(
  id: string,
  kind: 'module' | 'resource' | 'data' = 'module',
  moduleKey?: string,
  pins: { inputs?: NodePin[]; outputs?: NodePin[] } = {},
): RenderNode {
  return {
    id,
    label: id,
    kind,
    module_key: moduleKey,
    position: { x: 0, y: 0 },
    has_errors: false,
    error_messages: [],
    inputs: pins.inputs ?? [],
    outputs: pins.outputs ?? [],
  };
}

export function makePin(name: string, type = 'string', opts: Partial<NodePin> = {}): NodePin {
  return { name, type, ...opts };
}

export function makeEdge(
  source: string,
  target: string,
  sourceOutput: string,
  targetInput: string,
): RenderEdge {
  return {
    id: `${source}.${sourceOutput}->${target}.${targetInput}`,
    source,
    target,
    source_output: sourceOutput,
    target_input: targetInput,
  };
}
