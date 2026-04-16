// @vitest-environment jsdom
import { test, expect, describe } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGroupLogic, toAbsolutePositions } from '../hooks/useGroupLogic';
import type { RenderGroup } from '../types/render';
import { makeNode, makeEdge, makePin } from './helpers';
import type { Node } from '@xyflow/react';

// ── Helpers ──

function nodeWithPins(id: string, pins: { inputs?: string[]; outputs?: string[] } = {}) {
  return makeNode(id, 'module', undefined, {
    inputs: (pins.inputs ?? []).map((n) => makePin(n)),
    outputs: (pins.outputs ?? []).map((n) => makePin(n)),
  });
}

function withPosition(node: ReturnType<typeof makeNode>, x: number, y: number) {
  return { ...node, position: { x, y } };
}

function group(id: string, label: string, nodeIds: string[], collapsed = false): RenderGroup {
  return { id, label, node_ids: nodeIds, collapsed };
}

const empty = new Set<string>();

// ── No groups (fast path) ──

describe('useGroupLogic — no groups', () => {
  test('passes through nodes and edges unchanged', () => {
    const nodes = [
      withPosition(makeNode('vpc'), 100, 100),
      withPosition(makeNode('subnet'), 300, 100),
    ];
    const edges = [makeEdge('vpc', 'subnet', 'vpc_id', 'vpc_id')];

    const { result } = renderHook(() => useGroupLogic(nodes, edges, [], empty, empty));

    expect(result.current.rfNodes).toHaveLength(2);
    expect(result.current.rfEdges).toHaveLength(1);
    expect(result.current.rfNodes[0].id).toBe('vpc');
    expect(result.current.rfNodes[0].type).toBe('moduleNode');
    expect(result.current.rfNodes[0].parentId).toBeUndefined();
  });
});

// ── Expanded groups ──

describe('useGroupLogic — expanded groups', () => {
  test('creates group parent node and assigns children with parentId', () => {
    const nodes = [
      withPosition(makeNode('vpc'), 140, 160),
      withPosition(makeNode('subnet'), 340, 160),
      withPosition(makeNode('ec2'), 600, 100),
    ];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'])];

    const { result } = renderHook(() => useGroupLogic(nodes, [], groups, empty, empty));

    const groupNode = result.current.rfNodes.find((n) => n.id === 'g1');
    expect(groupNode).toBeDefined();
    expect(groupNode!.type).toBe('groupNode');

    const vpcNode = result.current.rfNodes.find((n) => n.id === 'vpc');
    expect(vpcNode!.parentId).toBe('g1');

    const subnetNode = result.current.rfNodes.find((n) => n.id === 'subnet');
    expect(subnetNode!.parentId).toBe('g1');

    // ec2 is ungrouped — no parentId
    const ec2Node = result.current.rfNodes.find((n) => n.id === 'ec2');
    expect(ec2Node!.parentId).toBeUndefined();
  });

  test('child positions are relative to group origin', () => {
    const nodes = [
      withPosition(makeNode('vpc'), 140, 160),
      withPosition(makeNode('subnet'), 340, 160),
    ];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'])];

    const { result } = renderHook(() => useGroupLogic(nodes, [], groups, empty, empty));

    const groupNode = result.current.rfNodes.find((n) => n.id === 'g1')!;
    const vpcNode = result.current.rfNodes.find((n) => n.id === 'vpc')!;
    const subnetNode = result.current.rfNodes.find((n) => n.id === 'subnet')!;

    // group origin = min_x - padding_x, min_y - padding_top = 140-40, 160-60 = (100, 100)
    expect(groupNode.position.x).toBe(100);
    expect(groupNode.position.y).toBe(100);

    // vpc at (140,160) relative to group at (100,100) = (40, 60)
    expect(vpcNode.position.x).toBe(40);
    expect(vpcNode.position.y).toBe(60);

    // subnet at (340,160) relative to group at (100,100) = (240, 60)
    expect(subnetNode.position.x).toBe(240);
    expect(subnetNode.position.y).toBe(60);
  });

  test('edges between grouped nodes render normally', () => {
    const nodes = [
      withPosition(makeNode('vpc'), 100, 100),
      withPosition(makeNode('subnet'), 300, 100),
    ];
    const edges = [makeEdge('vpc', 'subnet', 'vpc_id', 'vpc_id')];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'])];

    const { result } = renderHook(() => useGroupLogic(nodes, edges, groups, empty, empty));

    // Edge should pass through unchanged (both endpoints in same expanded group)
    expect(result.current.rfEdges).toHaveLength(1);
    expect(result.current.rfEdges[0].source).toBe('vpc');
    expect(result.current.rfEdges[0].target).toBe('subnet');
  });
});

// ── Collapsed groups ──

describe('useGroupLogic — collapsed groups', () => {
  test('hides member nodes', () => {
    const nodes = [
      withPosition(makeNode('vpc'), 100, 100),
      withPosition(makeNode('subnet'), 300, 100),
      withPosition(makeNode('ec2'), 600, 100),
    ];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, [], groups, empty, empty));

    const vpcNode = result.current.rfNodes.find((n) => n.id === 'vpc');
    expect(vpcNode!.hidden).toBe(true);

    const subnetNode = result.current.rfNodes.find((n) => n.id === 'subnet');
    expect(subnetNode!.hidden).toBe(true);

    const ec2Node = result.current.rfNodes.find((n) => n.id === 'ec2');
    expect(ec2Node!.hidden).toBeUndefined();
  });

  test('creates collapsed group node', () => {
    const nodes = [
      withPosition(makeNode('vpc'), 100, 100),
      withPosition(makeNode('subnet'), 300, 100),
    ];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, [], groups, empty, empty));

    const groupNode = result.current.rfNodes.find((n) => n.id === 'g1');
    expect(groupNode).toBeDefined();
    expect(groupNode!.type).toBe('groupNode');
    expect(groupNode!.data.collapsed).toBe(true);
    expect(groupNode!.data.memberCount).toBe(2);
  });

  test('hides internal edges', () => {
    const nodes = [
      withPosition(makeNode('vpc'), 100, 100),
      withPosition(makeNode('subnet'), 300, 100),
    ];
    const edges = [makeEdge('vpc', 'subnet', 'vpc_id', 'vpc_id')];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, edges, groups, empty, empty));

    // Internal edge should be hidden — not in the output
    expect(result.current.rfEdges).toHaveLength(0);
  });

  test('remaps outbound edges to group node with external pins', () => {
    const nodes = [
      withPosition(nodeWithPins('vpc', { outputs: ['vpc_id'] }), 100, 100),
      withPosition(makeNode('subnet'), 300, 100),
      withPosition(makeNode('ec2'), 500, 100),
    ];
    const edges = [makeEdge('vpc', 'ec2', 'vpc_id', 'vpc_id')];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, edges, groups, empty, empty));

    // Edge should be remapped: source = g1, target = ec2
    const remapped = result.current.rfEdges.find((e) => e.id === 'vpc.vpc_id->ec2.vpc_id');
    expect(remapped).toBeDefined();
    expect(remapped!.source).toBe('g1');
    expect(remapped!.target).toBe('ec2');
    expect(remapped!.sourceHandle).toBe('out:vpc/vpc_id');

    // Group node should have external pin
    const groupNode = result.current.rfNodes.find((n) => n.id === 'g1')!;
    const pins = groupNode.data.externalPins as Array<{ handleId: string }>;
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.some((p) => p.handleId === 'out:vpc/vpc_id')).toBe(true);
  });

  test('remapped edges store original source/target', () => {
    const nodes = [
      withPosition(nodeWithPins('vpc', { outputs: ['vpc_id'] }), 100, 100),
      withPosition(makeNode('subnet'), 300, 100),
      withPosition(makeNode('ec2'), 500, 100),
    ];
    const edges = [makeEdge('vpc', 'ec2', 'vpc_id', 'vpc_id')];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, edges, groups, empty, empty));

    const remapped = result.current.rfEdges[0];
    const data = remapped.data as Record<string, unknown>;
    expect(data.original_source).toBe('vpc');
    expect(data.original_target).toBe('ec2');
  });

  test('remaps inbound edges to group node', () => {
    const nodes = [
      withPosition(makeNode('ec2'), 100, 100),
      withPosition(nodeWithPins('vpc', { inputs: ['sg_id'] }), 400, 100),
      withPosition(makeNode('subnet'), 400, 200),
    ];
    // Edge from outside (ec2) to inside (vpc)
    const edges = [makeEdge('ec2', 'vpc', 'sg_id', 'sg_id')];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, edges, groups, empty, empty));

    const remapped = result.current.rfEdges[0];
    expect(remapped.source).toBe('ec2');
    expect(remapped.target).toBe('g1'); // remapped to group
    expect(remapped.targetHandle).toBe('in:vpc/sg_id');

    // Group should have an external input pin
    const groupNode = result.current.rfNodes.find((n) => n.id === 'g1')!;
    const pins = groupNode.data.externalPins as Array<{ handleId: string; side: string }>;
    expect(pins.some((p) => p.handleId === 'in:vpc/sg_id' && p.side === 'input')).toBe(true);
  });

  test('deduplicates edges between two collapsed groups', () => {
    const nodes = [
      withPosition(nodeWithPins('vpc', { outputs: ['vpc_id'] }), 100, 100),
      withPosition(makeNode('nat'), 100, 200),
      withPosition(nodeWithPins('sg', { inputs: ['vpc_id'] }), 400, 100),
      withPosition(makeNode('rule'), 400, 200),
    ];
    const edges = [makeEdge('vpc', 'sg', 'vpc_id', 'vpc_id')];
    const groups = [
      group('g1', 'Network', ['vpc', 'nat'], true),
      group('g2', 'Security', ['sg', 'rule'], true),
    ];

    const { result } = renderHook(() => useGroupLogic(nodes, edges, groups, empty, empty));

    // Edge should appear exactly once, not duplicated
    const matching = result.current.rfEdges.filter((e) => e.id === 'vpc.vpc_id->sg.vpc_id');
    expect(matching).toHaveLength(1);
    expect(matching[0].source).toBe('g1');
    expect(matching[0].target).toBe('g2');
  });
});

// ── Non-adjacent and edge-case grouping ──

describe('useGroupLogic — non-adjacent grouping', () => {
  test('grouping opposite ends of a DAG (A→B→C, group {A,C})', () => {
    const nodes = [
      withPosition(nodeWithPins('a', { outputs: ['out'] }), 100, 100),
      withPosition(nodeWithPins('b', { inputs: ['in'], outputs: ['out'] }), 300, 100),
      withPosition(nodeWithPins('c', { inputs: ['in'] }), 500, 100),
    ];
    // A → B → C
    const edges = [makeEdge('a', 'b', 'out', 'in'), makeEdge('b', 'c', 'out', 'in')];
    // Group the endpoints, leaving B in the middle
    const groups = [group('g1', 'Endpoints', ['a', 'c'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, edges, groups, empty, empty));

    // B should be visible (not in group)
    const bNode = result.current.rfNodes.find((n) => n.id === 'b');
    expect(bNode!.hidden).toBeUndefined();

    // A→B remapped: group→B (outbound)
    const outEdge = result.current.rfEdges.find((e) => e.id === 'a.out->b.in');
    expect(outEdge).toBeDefined();
    expect(outEdge!.source).toBe('g1');
    expect(outEdge!.target).toBe('b');

    // B→C remapped: B→group (inbound)
    const inEdge = result.current.rfEdges.find((e) => e.id === 'b.out->c.in');
    expect(inEdge).toBeDefined();
    expect(inEdge!.source).toBe('b');
    expect(inEdge!.target).toBe('g1');

    // Group has both input and output handles
    const groupNode = result.current.rfNodes.find((n) => n.id === 'g1')!;
    const pins = groupNode.data.externalPins as Array<{ side: string }>;
    expect(pins.some((p) => p.side === 'output')).toBe(true);
    expect(pins.some((p) => p.side === 'input')).toBe(true);
  });

  test('grouping disconnected nodes (no edges between them)', () => {
    const nodes = [withPosition(makeNode('x'), 100, 100), withPosition(makeNode('y'), 500, 500)];
    // No edges at all
    const groups = [group('g1', 'Scattered', ['x', 'y'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, [], groups, empty, empty));

    const groupNode = result.current.rfNodes.find((n) => n.id === 'g1')!;
    expect(groupNode.data.memberCount).toBe(2);
    // No external pins — no edges cross the boundary
    expect((groupNode.data.externalPins as unknown[]).length).toBe(0);
    // No edges
    expect(result.current.rfEdges).toHaveLength(0);
  });

  test('grouping all nodes — collapsed group with no external edges', () => {
    const nodes = [
      withPosition(nodeWithPins('a', { outputs: ['out'] }), 100, 100),
      withPosition(nodeWithPins('b', { inputs: ['in'] }), 300, 100),
    ];
    const edges = [makeEdge('a', 'b', 'out', 'in')];
    const groups = [group('g1', 'Everything', ['a', 'b'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, edges, groups, empty, empty));

    // Internal edge hidden — no edges in output
    expect(result.current.rfEdges).toHaveLength(0);

    // Group has no external pins
    const groupNode = result.current.rfNodes.find((n) => n.id === 'g1')!;
    expect((groupNode.data.externalPins as unknown[]).length).toBe(0);
    expect(groupNode.data.collapsed).toBe(true);
  });
});

// ── Error propagation ──

describe('useGroupLogic — error state', () => {
  test('collapsed group surfaces hasErrors from members', () => {
    const vpc = withPosition(makeNode('vpc'), 100, 100);
    vpc.has_errors = true;
    const nodes = [vpc, withPosition(makeNode('subnet'), 300, 100)];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, [], groups, empty, empty));

    const groupNode = result.current.rfNodes.find((n) => n.id === 'g1')!;
    expect(groupNode.data.hasErrors).toBe(true);
  });

  test('collapsed group without errors has hasErrors false', () => {
    const nodes = [
      withPosition(makeNode('vpc'), 100, 100),
      withPosition(makeNode('subnet'), 300, 100),
    ];
    const groups = [group('g1', 'Network', ['vpc', 'subnet'], true)];

    const { result } = renderHook(() => useGroupLogic(nodes, [], groups, empty, empty));

    const groupNode = result.current.rfNodes.find((n) => n.id === 'g1')!;
    expect(groupNode.data.hasErrors).toBe(false);
  });
});

// ── toAbsolutePositions ──

describe('toAbsolutePositions', () => {
  test('ungrouped node drag returns position as-is', () => {
    const dragged: Node = { id: 'vpc', type: 'moduleNode', position: { x: 200, y: 300 }, data: {} };
    const result = toAbsolutePositions(dragged, [dragged], [dragged], []);

    expect(result).toEqual({ vpc: { x: 200, y: 300 } });
  });

  test('child node drag converts relative to absolute', () => {
    const parent: Node = { id: 'g1', type: 'groupNode', position: { x: 100, y: 100 }, data: {} };
    const child: Node = {
      id: 'vpc',
      type: 'moduleNode',
      position: { x: 40, y: 60 },
      parentId: 'g1',
      data: {},
    };
    const allNodes = [parent, child];

    const result = toAbsolutePositions(child, [child], allNodes, []);

    expect(result).toEqual({ vpc: { x: 140, y: 160 } });
  });

  test('group node drag updates all children', () => {
    const parent: Node = { id: 'g1', type: 'groupNode', position: { x: 200, y: 200 }, data: {} };
    const child1: Node = {
      id: 'vpc',
      type: 'moduleNode',
      position: { x: 40, y: 60 },
      parentId: 'g1',
      data: {},
    };
    const child2: Node = {
      id: 'subnet',
      type: 'moduleNode',
      position: { x: 240, y: 60 },
      parentId: 'g1',
      data: {},
    };
    const allNodes = [parent, child1, child2];
    const groups: RenderGroup[] = [
      { id: 'g1', label: 'Net', node_ids: ['vpc', 'subnet'], collapsed: false },
    ];

    const result = toAbsolutePositions(parent, [parent], allNodes, groups);

    expect(result).toEqual({
      vpc: { x: 240, y: 260 },
      subnet: { x: 440, y: 260 },
    });
  });

  test('collapsed group drag applies delta to all member positions', () => {
    // Members are hidden with absolute positions
    const parent: Node = { id: 'g1', type: 'groupNode', position: { x: 160, y: 140 }, data: {} };
    const vpc: Node = {
      id: 'vpc',
      type: 'moduleNode',
      position: { x: 140, y: 160 },
      hidden: true,
      data: {},
    };
    const subnet: Node = {
      id: 'subnet',
      type: 'moduleNode',
      position: { x: 340, y: 160 },
      hidden: true,
      data: {},
    };
    const allNodes = [parent, vpc, subnet];
    const groups: RenderGroup[] = [
      { id: 'g1', label: 'Net', node_ids: ['vpc', 'subnet'], collapsed: true },
    ];

    // Derived origin would be (140-40, 160-60) = (100, 100)
    // User dragged group to (160, 140), so delta = (60, 40)
    const result = toAbsolutePositions(parent, [parent], allNodes, groups);

    expect(result).toEqual({
      vpc: { x: 200, y: 200 }, // 140 + 60, 160 + 40
      subnet: { x: 400, y: 200 }, // 340 + 60, 160 + 40
    });
  });
});
