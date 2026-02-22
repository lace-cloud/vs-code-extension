import { test, expect } from 'vitest';
import { deriveEdges, deriveWires } from '../utils/derive';
import type { Instance } from '../types/ir';

test('out binding produces exactly one edge', () => {
  const instances: Instance[] = [
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'b',
      use: { module_id: 'y', version: 'v1' },
      inputs: { bucket: { out: { module: 'a', name: 'arn' } } },
    },
  ];
  const edges = deriveEdges(instances);
  expect(edges).toHaveLength(1);
  expect(edges[0]).toEqual({
    source_instance: 'a',
    target_instance: 'b',
    mapping: { from: 'arn', to: 'bucket' },
  });
});

test('no out bindings → 0 edges', () => {
  const instances: Instance[] = [
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    { kind: 'module', id: 'b', use: { module_id: 'y', version: 'v1' }, inputs: {} },
  ];
  expect(deriveEdges(instances)).toHaveLength(0);
});

test('lit and var bindings produce no edges', () => {
  const instances: Instance[] = [
    {
      kind: 'module',
      id: 'a',
      use: { module_id: 'x', version: 'v1' },
      inputs: { name: { lit: 'hello' }, region: { var: 'region' } },
    },
  ];
  expect(deriveEdges(instances)).toHaveLength(0);
});

test('deriveWires produces wire format from edges', () => {
  const instances: Instance[] = [
    { kind: 'module', id: 'vpc', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'sg',
      use: { module_id: 'y', version: 'v1' },
      inputs: { vpc_id: { out: { module: 'vpc', name: 'id' } } },
    },
  ];
  const wires = deriveWires(instances);
  expect(wires).toHaveLength(1);
  expect(wires[0]).toEqual({
    from: { module: 'vpc', port: 'outputs.id' },
    to: { module: 'sg', port: 'inputs.vpc_id' },
  });
});
