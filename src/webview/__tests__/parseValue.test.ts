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

test('parseConfigValue: "0" → 0', () => {
  expect(parseConfigValue('0')).toBe(0);
});

test('parseConfigValue: large integer → number', () => {
  expect(parseConfigValue('3600')).toBe(3600);
});

// ── Strings that must NOT coerce ──

test('parseConfigValue: float string stays string', () => {
  expect(parseConfigValue('3.14')).toBe('3.14');
});

test('parseConfigValue: negative number stays string', () => {
  expect(parseConfigValue('-1')).toBe('-1');
});

test('parseConfigValue: number with letters stays string', () => {
  expect(parseConfigValue('123abc')).toBe('123abc');
});

test('parseConfigValue: "True" (capitalized) stays string', () => {
  expect(parseConfigValue('True')).toBe('True');
});

test('parseConfigValue: "FALSE" (uppercase) stays string', () => {
  expect(parseConfigValue('FALSE')).toBe('FALSE');
});

test('parseConfigValue: empty string stays string', () => {
  expect(parseConfigValue('')).toBe('');
});

test('parseConfigValue: plain text stays string', () => {
  expect(parseConfigValue('us-east-1')).toBe('us-east-1');
});

test('parseConfigValue: path stays string', () => {
  expect(parseConfigValue('iam-stack/terraform.tfstate')).toBe('iam-stack/terraform.tfstate');
});

test('parseConfigValue: whitespace-padded number stays string', () => {
  expect(parseConfigValue(' 42 ')).toBe(' 42 ');
});
