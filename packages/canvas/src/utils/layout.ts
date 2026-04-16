// src/webview/utils/layout.ts
//
// Pure layout utilities for the canvas. No VS Code or DOM dependencies.

import type { RenderNode } from '../types/render';

// Matches CARD_SIZE in ModuleNode.tsx
const NODE_WIDTH = 42;
const NODE_HEIGHT = 42;
const NODE_GAP = 80;
const COLUMN_WRAP = 5;
const STEP_X = NODE_WIDTH + NODE_GAP;
const STEP_Y = NODE_HEIGHT + NODE_GAP;

/** Returns true if two nodes with the given positions would overlap. */
function overlaps(ax: number, ay: number, bx: number, by: number): boolean {
  return (
    Math.abs(ax - bx) < NODE_WIDTH + NODE_GAP / 2 && Math.abs(ay - by) < NODE_HEIGHT + NODE_GAP / 2
  );
}

/** Returns true if the candidate position overlaps any node in the list. */
function hasOverlap(nodes: RenderNode[], cx: number, cy: number): boolean {
  return nodes.some((n) => overlaps(n.position.x, n.position.y, cx, cy));
}

/**
 * Given the current nodes on the canvas and an optional anchor (the last
 * placed node's position), return a non-overlapping position for the next node.
 *
 * When an anchor is provided we scan right from the anchor in STEP_X increments
 * until a free slot is found. If nothing is free in that row we wrap down one
 * row and repeat. This keeps new modules near where the user last worked while
 * guaranteeing they never stack on top of each other.
 *
 * When no anchor is provided the origin falls back to the top-left corner of
 * all existing nodes (first-drop / cold-start behaviour).
 */
export function findFreePosition(
  nodes: RenderNode[],
  anchor?: { x: number; y: number },
): { x: number; y: number } {
  if (anchor) {
    // Scan rightward from anchor, wrapping down after COLUMN_WRAP attempts.
    for (let row = 0; row < 20; row++) {
      for (let col = 1; col <= COLUMN_WRAP; col++) {
        const cx = anchor.x + col * STEP_X;
        const cy = anchor.y + row * STEP_Y;
        if (!hasOverlap(nodes, cx, cy)) {
          return { x: cx, y: cy };
        }
      }
    }
    // Fallback: far right of anchor (should never reach here in practice)
    return { x: anchor.x + STEP_X, y: anchor.y };
  }

  if (nodes.length === 0) {
    return { x: 100, y: 100 };
  }

  // Fallback: grid anchored to the top-left of all existing nodes.
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const originX = Number.isFinite(minX) ? minX : 100;
  const originY = Number.isFinite(minY) ? minY : 100;

  // Scan grid slots until we find a free one.
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < COLUMN_WRAP; col++) {
      const cx = originX + col * STEP_X;
      const cy = originY + row * STEP_Y;
      if (!hasOverlap(nodes, cx, cy)) {
        return { x: cx, y: cy };
      }
    }
  }

  // Absolute fallback
  const col = nodes.length % COLUMN_WRAP;
  const row = Math.floor(nodes.length / COLUMN_WRAP);
  return { x: originX + col * STEP_X, y: originY + row * STEP_Y };
}

/**
 * Place nodes sequentially, finding a free position for each one relative to
 * the previous. Returns a map of node ID → position. Mutates `nodes` in place
 * to set their positions (so the webview renders correctly immediately).
 */
export function placeNodesSequentially(
  nodes: RenderNode[],
  existingNodes: RenderNode[],
  anchor?: { x: number; y: number },
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const placed = [...existingNodes];
  let currentAnchor = anchor;
  for (const node of nodes) {
    const pos = findFreePosition(placed, currentAnchor);
    positions[node.id] = pos;
    placed.push({ ...node, position: pos });
    node.position = pos;
    currentAnchor = pos;
  }
  return positions;
}

/**
 * Given existing nodes (to check against), the relative positions of a group
 * of nodes to be placed (e.g. [{relX: 0, relY: 0}, {relX: 122, relY: 0}]),
 * and the source group anchor (top-left corner of the source bounding box),
 * returns a position for the new group's top-left anchor such that no member
 * of the group overlaps any existing node.
 *
 * Scans rightward from the source anchor, wrapping down, so the pasted group
 * lands near the original group.
 */
export function findFreeGroupPosition(
  existingNodes: RenderNode[],
  relPositions: { relX: number; relY: number }[],
  sourceAnchor: { x: number; y: number },
): { x: number; y: number } {
  for (let row = 0; row < 20; row++) {
    for (let col = 1; col <= COLUMN_WRAP; col++) {
      const ax = sourceAnchor.x + col * STEP_X;
      const ay = sourceAnchor.y + row * STEP_Y;
      const allFree = relPositions.every(
        ({ relX, relY }) => !hasOverlap(existingNodes, ax + relX, ay + relY),
      );
      if (allFree) {
        return { x: ax, y: ay };
      }
    }
  }
  // Fallback: place well to the right of the source group
  return { x: sourceAnchor.x + STEP_X * 3, y: sourceAnchor.y };
}
