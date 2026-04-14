import type { CanvasView } from '../types/render';

export function applyPositionsToCanvasView(
  view: CanvasView,
  positions: Record<string, { x: number; y: number }>,
): CanvasView {
  return {
    ...view,
    nodes: view.nodes.map((node) =>
      positions[node.id] ? { ...node, position: positions[node.id] } : node,
    ),
  };
}
