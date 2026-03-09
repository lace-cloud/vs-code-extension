import { test, expect } from 'vitest';
import { parseConfigValue } from '../utils/parseValue';

// ── Booleans ──

test('parseConfigValue: "true" → true', () => {
  expect(parseConfigValue('true')).toBe(true);
});

test('parseConfigValue: "false" → false', () => {
  expect(parseConfigValue('false')).toBe(false);
});

// ── Numbers ──

test('parseConfigValue: integer string → number', () => {
  expect(parseConfigValue('42')).toBe(42);
});

// ── Boundary: NOT coerced ──

test('parseConfigValue: float string stays string', () => {
  expect(parseConfigValue('3.14')).toBe('3.14');
});

test('parseConfigValue: negative number stays string', () => {
  expect(parseConfigValue('-1')).toBe('-1');
});
