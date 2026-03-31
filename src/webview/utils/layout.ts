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
 * Given the current nodes on the canvas and an optional anchor (the last
 * placed node's position), return a non-overlapping position for the next node.
 *
 * When an anchor is provided the new node is placed one step to the right of
 * it. The caller is responsible for updating the anchor after each placement,
 * so subsequent calls naturally chain right across the canvas near where the
 * user last worked.
 *
 * When no anchor is provided the origin falls back to the top-left corner of
 * all existing nodes (first-drop / cold-start behaviour).
 */
export function findFreePosition(
  nodes: RenderNode[],
  anchor?: { x: number; y: number },
): { x: number; y: number } {
  const stepX = NODE_WIDTH + NODE_GAP;

  if (anchor) {
    // Place one step to the right of the last added node.
    return { x: anchor.x + stepX, y: anchor.y };
  }

  if (nodes.length === 0) {
    return { x: 100, y: 100 };
  }

  // Fallback: grid anchored to the top-left of all existing nodes.
  const stepY = NODE_HEIGHT + NODE_GAP;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const originX = Number.isFinite(minX) ? minX : 100;
  const originY = Number.isFinite(minY) ? minY : 100;
  const col = nodes.length % COLUMN_WRAP;
  const row = Math.floor(nodes.length / COLUMN_WRAP);
  return { x: originX + col * stepX, y: originY + row * stepY };
}
