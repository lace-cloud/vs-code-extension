import { test, expect } from 'vitest';
import { normalizeBinding } from '../utils/bundle';
import { isLit, isVar, isExpr } from '../types/ir';

test('Go zero-value leak resolves to lit', () => {
  expect(normalizeBinding({ lit: null, var: '' })).toEqual({ lit: null });
});

test('out binding wins over lit zero-value', () => {
  expect(normalizeBinding({ lit: null, out: { module: 'a', name: 'arn' } })).toEqual({
    out: { module: 'a', name: 'arn' },
  });
});

test('empty out binding falls through to lit', () => {
  expect(normalizeBinding({ out: { module: '', name: '' }, lit: 'hello' })).toEqual({
    lit: 'hello',
  });
});

test('deploy_bundle empty lit placeholder', () => {
  const result = normalizeBinding({ lit: {} });
  expect(result).toEqual({ lit: {} });
  expect(isLit(result)).toBe(true);
});

test('var binding', () => {
  const result = normalizeBinding({ var: 'bucket_name' });
  expect(result).toEqual({ var: 'bucket_name' });
  expect(isVar(result)).toBe(true);
});

test('expr binding', () => {
  const result = normalizeBinding({ expr: { lang: 'hcl', value: 'var.x + 1' } });
  expect(result).toEqual({ expr: { lang: 'hcl', value: 'var.x + 1' } });
  expect(isExpr(result)).toBe(true);
});

test('all-zero raw falls through to lit null', () => {
  expect(normalizeBinding({})).toEqual({ lit: null });
});
