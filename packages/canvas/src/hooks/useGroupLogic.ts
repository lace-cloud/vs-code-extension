// src/webview/hooks/useGroupLogic.ts
//
// Transforms flat CanvasView data into React Flow nodes/edges that support
// visual groups with expand/collapse. Groups are purely visual — they live
// in GraphLayout and don't affect Terraform generation.

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { RenderNode, RenderEdge, RenderGroup } from '../types/render';
import type { ExternalPin } from '../components/nodes/GroupNode';
import { pinColor } from '../components/nodes/pinColor';

// ── Constants ──

const GROUP_PADDING_X = 40;
const GROUP_PADDING_TOP = 60; // header + gap
const GROUP_PADDING_BOTTOM = 20;

// Estimated node dimensions (matches ModuleNode constants)
const NODE_WIDTH = 200;
const NODE_HEADER_HEIGHT = 28;
const NODE_ROW_HEIGHT = 22;

// ── Types ──

type GroupLogicResult = {
  rfNodes: Node[];
  rfEdges: Edge[];
};

// ── Position conversion ──

/**
 * Convert React Flow node positions to absolute positions for syncLayout.
 * Child nodes inside expanded groups have relative positions that need
 * conversion back to absolute coordinates.
 */
export function toAbsolutePositions(
  draggedNode: Node,
  draggedNodes: Node[],
  allRfNodes: Node[],
  groups: RenderGroup[],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};

  if (draggedNode.type === 'groupNode') {
    const group = groups.find((g) => g.id === draggedNode.id);
    if (!group) return positions;

    if (group.collapsed) {
      // Collapsed group dragged — compute delta from the derived origin
      // and apply it to all member nodes' absolute positions
      const memberNodes = group.node_ids
        .map((id) => allRfNodes.find((n) => n.id === id))
        .filter((n): n is Node => n !== undefined);

      if (memberNodes.length === 0) return positions;

      const derivedOrigin = {
        x: Math.min(...memberNodes.map((n) => n.position.x)) - GROUP_PADDING_X,
        y: Math.min(...memberNodes.map((n) => n.position.y)) - GROUP_PADDING_TOP,
      };
      const dx = draggedNode.position.x - derivedOrigin.x;
      const dy = draggedNode.position.y - derivedOrigin.y;

      for (const n of memberNodes) {
        positions[n.id] = {
          x: n.position.x + dx,
          y: n.position.y + dy,
        };
      }
    } else {
      // Expanded group dragged — children have relative positions
      for (const n of allRfNodes) {
        if (n.parentId === draggedNode.id) {
          positions[n.id] = {
            x: draggedNode.position.x + n.position.x,
            y: draggedNode.position.y + n.position.y,
          };
        }
      }
    }
    return positions;
  }

  // Regular nodes — convert relative to absolute if parented
  const groupNodeMap = new Map<string, Node>();
  for (const n of allRfNodes) {
    if (n.type === 'groupNode') groupNodeMap.set(n.id, n);
  }

  for (const n of draggedNodes) {
    if (n.parentId && groupNodeMap.has(n.parentId)) {
      const parent = groupNodeMap.get(n.parentId)!;
      positions[n.id] = {
        x: parent.position.x + n.position.x,
        y: parent.position.y + n.position.y,
      };
    } else {
      positions[n.id] = n.position;
    }
  }

  return positions;
}

// ── Hook ──

export function useGroupLogic(
  nodes: RenderNode[],
  edges: RenderEdge[],
  groups: RenderGroup[],
  newNodeIds: Set<string>,
  erroredNodeIds: Set<string>,
): GroupLogicResult {
  return useMemo(() => {
    if (groups.length === 0) {
      // No groups — pass through unchanged (fast path)
      return {
        rfNodes: nodes.map((n) => ({
          id: n.id,
          type: 'moduleNode',
          position: n.position,
          data: { ...n, isNew: newNodeIds.has(n.id), hasError: erroredNodeIds.has(n.id) },
        })),
        rfEdges: edges.map(renderEdgeToRfEdge),
      };
    }

    // Build lookup: nodeId → group, and parent-of-group for nested
    // groups. Nested RenderGroups — iam_stack contains
    // cloudwatch_logs_policy — mean a collapsed ancestor must hide
    // every descendant group and every descendant node.
    const nodeToGroup = new Map<string, RenderGroup>();
    const groupById = new Map<string, RenderGroup>();
    const parentOfGroup = new Map<string, string>(); // childGroupId → parentGroupId
    for (const g of groups) {
      groupById.set(g.id, g);
    }
    for (const g of groups) {
      for (const nid of g.node_ids) {
        if (groupById.has(nid)) {
          parentOfGroup.set(nid, g.id);
        } else {
          nodeToGroup.set(nid, g);
        }
      }
    }

    const ancestorCollapsedCache = new Map<string, boolean>();
    const isAncestorCollapsed = (groupId: string): boolean => {
      if (ancestorCollapsedCache.has(groupId))
        return ancestorCollapsedCache.get(groupId) as boolean;
      let cursor = parentOfGroup.get(groupId);
      while (cursor) {
        const parent = groupById.get(cursor);
        if (parent?.collapsed) {
          ancestorCollapsedCache.set(groupId, true);
          return true;
        }
        cursor = parentOfGroup.get(cursor);
      }
      ancestorCollapsedCache.set(groupId, false);
      return false;
    };

    // Build node map for quick lookups
    const nodeMap = new Map<string, RenderNode>();
    for (const n of nodes) {
      nodeMap.set(n.id, n);
    }

    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    // ── Process each group ──
    for (const group of groups) {
      const hiddenByAncestor = isAncestorCollapsed(group.id);
      const memberNodes = group.node_ids
        .map((id) => nodeMap.get(id))
        .filter((n): n is RenderNode => n !== undefined);

      if (group.collapsed) {
        // Collapsed: compute external pins, hide member nodes
        const { externalPins, remappedEdges } = computeCollapsedGroup(
          group,
          edges,
          nodeToGroup,
          nodeMap,
        );

        const hasErrors = memberNodes.some((n) => n.has_errors);

        rfNodes.push({
          id: group.id,
          type: 'groupNode',
          position: computeGroupOrigin(memberNodes),
          hidden: hiddenByAncestor,
          data: {
            groupId: group.id,
            label: group.label,
            memberCount: memberNodes.length,
            collapsed: true,
            hasErrors,
            externalPins,
          },
        });

        // Add hidden member nodes (React Flow still needs them for internal bookkeeping)
        for (const n of memberNodes) {
          rfNodes.push({
            id: n.id,
            type: 'moduleNode',
            position: n.position,
            hidden: true,
            data: { ...n, isNew: newNodeIds.has(n.id), hasError: erroredNodeIds.has(n.id) },
          });
        }

        rfEdges.push(...remappedEdges);
      } else {
        // Expanded: create parent node, assign children with relative positions
        const origin = computeGroupOrigin(memberNodes);
        const bounds = computeGroupBounds(memberNodes);

        rfNodes.push({
          id: group.id,
          type: 'groupNode',
          position: origin,
          hidden: hiddenByAncestor,
          style: {
            width: bounds.width,
            height: bounds.height,
          },
          data: {
            groupId: group.id,
            label: group.label,
            memberCount: memberNodes.length,
            collapsed: false,
            hasErrors: false,
            externalPins: [],
          },
        });

        for (const n of memberNodes) {
          rfNodes.push({
            id: n.id,
            type: 'moduleNode',
            position: {
              x: n.position.x - origin.x,
              y: n.position.y - origin.y,
            },
            parentId: group.id,
            extent: 'parent' as const,
            hidden: hiddenByAncestor,
            data: { ...n, isNew: newNodeIds.has(n.id), hasError: erroredNodeIds.has(n.id) },
          });
        }
      }
    }

    // ── Ungrouped nodes ──
    for (const n of nodes) {
      if (!nodeToGroup.has(n.id)) {
        rfNodes.push({
          id: n.id,
          type: 'moduleNode',
          position: n.position,
          data: { ...n, isNew: newNodeIds.has(n.id), hasError: erroredNodeIds.has(n.id) },
        });
      }
    }

    // ── Deduplicate remapped edges (cross-group edges get processed by both groups) ──
    const deduped = new Map<string, Edge>();
    for (const e of rfEdges) {
      deduped.set(e.id, e);
    }

    // ── Add edges not handled by collapsed groups ──
    for (const e of edges) {
      if (deduped.has(e.id)) continue;

      const srcGroup = nodeToGroup.get(e.source);
      const tgtGroup = nodeToGroup.get(e.target);

      // Skip edges internal to collapsed groups (already handled)
      if (srcGroup?.collapsed && tgtGroup?.collapsed && srcGroup.id === tgtGroup.id) continue;

      deduped.set(e.id, renderEdgeToRfEdge(e));
    }

    return { rfNodes, rfEdges: Array.from(deduped.values()) };
  }, [nodes, edges, groups, newNodeIds, erroredNodeIds]);
}

// ── Helpers ──

function renderEdgeToRfEdge(e: RenderEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: `out:${e.source_output}`,
    targetHandle: `in:${e.target_input}`,
    data: { source_output: e.source_output, target_input: e.target_input },
    type: 'default',
  };
}

function computeGroupOrigin(members: RenderNode[]): { x: number; y: number } {
  if (members.length === 0) return { x: 0, y: 0 };
  const minX = Math.min(...members.map((n) => n.position.x));
  const minY = Math.min(...members.map((n) => n.position.y));
  return {
    x: minX - GROUP_PADDING_X,
    y: minY - GROUP_PADDING_TOP,
  };
}

function estimateNodeHeight(n: RenderNode): number {
  const rows = Math.max(n.inputs.length, n.outputs.length);
  return NODE_HEADER_HEIGHT + rows * NODE_ROW_HEIGHT;
}

function computeGroupBounds(members: RenderNode[]): { width: number; height: number } {
  if (members.length === 0) return { width: 280, height: 120 };
  const minX = Math.min(...members.map((n) => n.position.x));
  const minY = Math.min(...members.map((n) => n.position.y));
  const maxX = Math.max(...members.map((n) => n.position.x));
  const maxBottom = Math.max(...members.map((n) => n.position.y + estimateNodeHeight(n)));
  return {
    width: maxX - minX + NODE_WIDTH + GROUP_PADDING_X * 2,
    height: maxBottom - minY + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM,
  };
}

function computeCollapsedGroup(
  group: RenderGroup,
  allEdges: RenderEdge[],
  nodeToGroup: Map<string, RenderGroup>,
  nodeMap: Map<string, RenderNode>,
): { externalPins: ExternalPin[]; remappedEdges: Edge[] } {
  const memberSet = new Set(group.node_ids);
  const externalOutputs = new Map<string, ExternalPin>(); // handleId → pin
  const externalInputs = new Map<string, ExternalPin>();
  const remappedEdges: Edge[] = [];

  // Module-backed groups carry their target's declared Interface as
  // boundary pins: registry drops whose target has its own sub-modules
  // publish inputs/outputs straight from the CLI's ProjectCanvasView.
  // When present, these are the authoritative boundary surface — seed
  // externalInputs/Outputs from them before scanning edges so the UI
  // renders pins regardless of whether any edge actually crosses the
  // boundary. User-created groups (today empty inputs/outputs) fall
  // back to edge-derived pin discovery.
  if (group.inputs) {
    for (const pin of group.inputs) {
      const handleId = `in:${pin.name}`;
      externalInputs.set(handleId, {
        handleId,
        label: pin.name,
        side: 'input',
        color: pinColor(pin),
      });
    }
  }
  if (group.outputs) {
    for (const pin of group.outputs) {
      const handleId = `out:${pin.name}`;
      externalOutputs.set(handleId, {
        handleId,
        label: pin.name,
        side: 'output',
        color: pinColor(pin),
      });
    }
  }

  for (const e of allEdges) {
    const srcInside = memberSet.has(e.source);
    const tgtInside = memberSet.has(e.target);

    if (srcInside && tgtInside) {
      // Internal edge — hide entirely
      continue;
    }

    if (srcInside && !tgtInside) {
      // Outbound: remap source to group node
      const handleId = `out:${e.source}/${e.source_output}`;
      if (!externalOutputs.has(handleId)) {
        const srcNode = nodeMap.get(e.source);
        const pin = srcNode?.outputs.find((p) => p.name === e.source_output);
        externalOutputs.set(handleId, {
          handleId,
          label: `${e.source}.${e.source_output}`,
          side: 'output',
          color: pin ? pinColor(pin) : { fill: '#9BA19E', stroke: '#4A4F4C' },
        });
      }

      // Check if target is also in a collapsed group
      const tgtGroup = nodeToGroup.get(e.target);
      const targetId = tgtGroup?.collapsed ? tgtGroup.id : e.target;
      const targetHandle = tgtGroup?.collapsed
        ? `in:${e.target}/${e.target_input}`
        : `in:${e.target_input}`;

      remappedEdges.push({
        id: e.id,
        source: group.id,
        target: targetId,
        sourceHandle: handleId,
        targetHandle,
        data: {
          source_output: e.source_output,
          target_input: e.target_input,
          original_source: e.source,
          original_target: e.target,
        },
        type: 'default',
      });
    }

    if (!srcInside && tgtInside) {
      // Inbound: remap target to group node
      const handleId = `in:${e.target}/${e.target_input}`;
      if (!externalInputs.has(handleId)) {
        const tgtNode = nodeMap.get(e.target);
        const pin = tgtNode?.inputs.find((p) => p.name === e.target_input);
        externalInputs.set(handleId, {
          handleId,
          label: `${e.target}.${e.target_input}`,
          side: 'input',
          color: pin ? pinColor(pin) : { fill: '#9BA19E', stroke: '#4A4F4C' },
        });
      }

      // Check if source is also in a collapsed group
      const srcGroup = nodeToGroup.get(e.source);
      const sourceId = srcGroup?.collapsed ? srcGroup.id : e.source;
      const sourceHandle = srcGroup?.collapsed
        ? `out:${e.source}/${e.source_output}`
        : `out:${e.source_output}`;

      remappedEdges.push({
        id: e.id,
        source: sourceId,
        target: group.id,
        sourceHandle,
        targetHandle: handleId,
        data: {
          source_output: e.source_output,
          target_input: e.target_input,
          original_source: e.source,
          original_target: e.target,
        },
        type: 'default',
      });
    }
  }

  const externalPins = [
    ...Array.from(externalInputs.values()),
    ...Array.from(externalOutputs.values()),
  ];

  return { externalPins, remappedEdges };
}
