import { expect, test } from 'vitest';
import { findDuplicateIndices } from '../utils/duplicates';

test('returns empty set when no duplicates', () => {
  const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  expect(findDuplicateIndices(items, (i) => i.name).size).toBe(0);
});

test('finds duplicate indices', () => {
  const items = [{ name: 'a' }, { name: 'b' }, { name: 'a' }];
  const dupes = findDuplicateIndices(items, (i) => i.name);
  expect(dupes).toEqual(new Set([0, 2]));
});

test('case insensitive matching', () => {
  const items = [{ name: 'Dev' }, { name: 'dev' }];
  const dupes = findDuplicateIndices(items, (i) => i.name);
  expect(dupes).toEqual(new Set([0, 1]));
});

test('skips empty keys', () => {
  const items = [{ name: '' }, { name: '' }, { name: 'a' }];
  const dupes = findDuplicateIndices(items, (i) => i.name);
  expect(dupes.size).toBe(0);
});

test('handles empty list', () => {
  expect(findDuplicateIndices([], (i: string) => i).size).toBe(0);
});
