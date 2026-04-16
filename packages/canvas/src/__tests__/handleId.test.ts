import { test, expect } from 'vitest';
import { parseHandleId } from '../utils/handleId';

test('parses input handle', () => {
  expect(parseHandleId('in:vpc_id', 'in')).toBe('vpc_id');
});

test('parses output handle', () => {
  expect(parseHandleId('out:arn', 'out')).toBe('arn');
});

test('returns null for wrong prefix', () => {
  expect(parseHandleId('out:name', 'in')).toBeNull();
});

test('returns null for null/undefined', () => {
  expect(parseHandleId(null, 'in')).toBeNull();
  expect(parseHandleId(undefined, 'out')).toBeNull();
});

test('returns null for empty name after prefix', () => {
  expect(parseHandleId('in:', 'in')).toBeNull();
});
