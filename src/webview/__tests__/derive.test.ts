import { test, expect } from 'vitest';
import { deriveEdges } from '../utils/derive';
import type { Binding } from '../types/ir';

type Child = { id: string; inputs?: Record<string, Binding> };

test('out binding produces exactly one edge', () => {
  const children: Child[] = [
    { id: 'a', inputs: {} },
    {
      id: 'b',
      inputs: { bucket: { out: { module: 'a', name: 'arn' } } },
    },
  ];
  const edges = deriveEdges(children);
  expect(edges).toHaveLength(1);
  expect(edges[0]).toEqual({
    source_instance: 'a',
    target_instance: 'b',
    mapping: { from: 'arn', to: 'bucket' },
  });
});

test('multiple out bindings from different sources produce multiple edges', () => {
  const children: Child[] = [
    { id: 'vpc', inputs: {} },
    { id: 'bucket', inputs: {} },
    {
      id: 'lambda',
      inputs: {
        vpc_id: { out: { module: 'vpc', name: 'id' } },
        bucket_arn: { out: { module: 'bucket', name: 'arn' } },
      },
    },
  ];
  const edges = deriveEdges(children);
  expect(edges).toHaveLength(2);
  expect(edges).toContainEqual({
    source_instance: 'vpc',
    target_instance: 'lambda',
    mapping: { from: 'id', to: 'vpc_id' },
  });
  expect(edges).toContainEqual({
    source_instance: 'bucket',
    target_instance: 'lambda',
    mapping: { from: 'arn', to: 'bucket_arn' },
  });
});
