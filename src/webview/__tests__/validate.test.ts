import { test, expect } from 'vitest';
import { validateWorkspace } from '../utils/validate';
import { makeWorkspace } from './helpers';
import type { Module } from '../types/ir';

test('valid workspace produces no errors', () => {
  const ws = makeWorkspace(
    [
      { id: 'a', module: 'x@v1' },
      {
        id: 'b',
        module: 'x@v1',
        inputs: { bucket: { out: { module: 'a', name: 'arn' } } },
      },
    ],
    {
      'x@v1': {
        id: 'x',
        version: 'v1',
        interface: { inputs: [], outputs: [] },
        source: { kind: 'registry', ref: 'x/aws/v1' },
        exports: { outputs: {} },
      } as Module,
    },
    {},
    { my_output: { out: { module: 'a', name: 'arn' } } },
  );
  expect(validateWorkspace(ws)).toHaveLength(0);
});

test('catches duplicate instance IDs', () => {
  const ws = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    { id: 'a', module: 'y@v1' },
  ]);
  const errors = validateWorkspace(ws);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.some((e) => e.message.includes('Duplicate instance ID'))).toBe(true);
});

test('catches out bindings referencing unknown instances', () => {
  const ws = makeWorkspace([
    {
      id: 'b',
      module: 'x@v1',
      inputs: { bucket: { out: { module: 'nonexistent', name: 'arn' } } },
    },
  ]);
  const errors = validateWorkspace(ws);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.some((e) => e.message.includes('unknown instance "nonexistent"'))).toBe(true);
});

test('catches depends_on referencing unknown instances', () => {
  const ws = makeWorkspace([
    {
      id: 'a',
      module: 'x@v1',
      depends_on: ['ghost'],
    },
  ]);
  const errors = validateWorkspace(ws);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.some((e) => e.message.includes('depends_on'))).toBe(true);
});

test('catches use references pointing to modules not in workspace', () => {
  const ws = makeWorkspace([
    {
      id: 'a',
      module: 'missing-module@v9.9.9',
    },
  ]);
  const errors = validateWorkspace(ws);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.some((e) => e.message.includes('unknown module'))).toBe(true);
});

test('depends_on with module. prefix referencing valid instance produces no error', () => {
  const ws = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    {
      id: 'b',
      module: 'x@v1',
      depends_on: ['module.a'],
    },
  ]);
  const errors = validateWorkspace(ws);
  expect(errors.filter((e) => e.message.includes('depends_on'))).toHaveLength(0);
});

test('depends_on with module. prefix referencing unknown instance catches error', () => {
  const ws = makeWorkspace([
    {
      id: 'a',
      module: 'x@v1',
      depends_on: ['module.ghost'],
    },
  ]);
  const errors = validateWorkspace(ws);
  expect(
    errors.some((e) => e.message.includes('depends_on') && e.message.includes('module.ghost')),
  ).toBe(true);
});

test('detects multiple error types simultaneously', () => {
  const ws = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    { id: 'a', module: 'y@v1' }, // duplicate
    {
      id: 'b',
      module: 'missing-mod@v1',
      inputs: { x: { out: { module: 'nonexistent', name: 'v' } } }, // bad binding
      depends_on: ['ghost'], // bad depends_on
    },
  ]);
  const errors = validateWorkspace(ws);
  expect(errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  expect(errors.some((e) => e.message.includes('unknown instance "nonexistent"'))).toBe(true);
  expect(errors.some((e) => e.message.includes('depends_on'))).toBe(true);
  expect(errors.some((e) => e.message.includes('unknown module'))).toBe(true);
  expect(errors.length).toBeGreaterThanOrEqual(4);
});

test('catches export outputs referencing unknown instances', () => {
  const ws = makeWorkspace(
    [{ id: 'a', module: 'x@v1' }],
    {},
    {},
    { bad_export: { out: { module: 'nonexistent', name: 'arn' } } },
  );
  const errors = validateWorkspace(ws);
  expect(errors.length).toBeGreaterThan(0);
  expect(
    errors.some((e) => e.message.includes('Export') && e.message.includes('nonexistent')),
  ).toBe(true);
});
