// src/webview/utils/layout.ts
//
// Pure layout utilities for the canvas. No VS Code or DOM dependencies.

import type { RenderNode } from '../types/render';

// Matches CARD_SIZE in ModuleNode.tsx
const NODE_WIDTH = 42;
const NODE_HEIGHT = 42;
const NODE_GAP = 80;
const COLUMN_WRAP = 5;

/**
 * Given the current nodes on the canvas, return a position for the next node
 * that does not overlap any existing node. Arranges nodes in a left-to-right,
 * top-to-bottom grid anchored at the top-left of existing nodes.
 */
export function findFreePosition(nodes: RenderNode[]): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 100, y: 100 };
  }

  const col = nodes.length % COLUMN_WRAP;
  const row = Math.floor(nodes.length / COLUMN_WRAP);
  const stepX = NODE_WIDTH + NODE_GAP;
  const stepY = NODE_HEIGHT + NODE_GAP;

  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const originX = Number.isFinite(minX) ? minX : 100;
  const originY = Number.isFinite(minY) ? minY : 100;

  return { x: originX + col * stepX, y: originY + row * stepY };
}
