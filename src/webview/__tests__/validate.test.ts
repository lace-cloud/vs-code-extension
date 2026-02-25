import { test, expect } from 'vitest';
import { validateWorkspace } from '../utils/validate';
import type { WorkspaceState } from '../types/workspace';
import type { ModuleDef, Instance } from '../types/ir';

/** Build a minimal workspace for validation testing */
function makeWorkspace(
  instances: Instance[],
  exports: Record<string, any> = {},
  extraModules: Record<string, ModuleDef> = {},
): WorkspaceState {
  const moduleKey = 'root@v1.0.0';
  return {
    schema_version: '1.0',
    kind: 'module_bundle',
    entry: { module_id: 'root', version: 'v1.0.0' },
    modules: {
      [moduleKey]: {
        schema_version: '1.0',
        kind: 'module_def',
        id: 'root',
        version: 'v1.0.0',
        interface: { inputs: [], outputs: [] },
        impl: {
          kind: 'composite',
          graph: {
            instances,
            exports: { outputs: exports },
          },
        },
      },
      ...extraModules,
    },
    layouts: {},
  };
}

test('valid workspace produces no errors', () => {
  const ws = makeWorkspace(
    [
      { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
      {
        kind: 'module',
        id: 'b',
        use: { module_id: 'x', version: 'v1' },
        inputs: { bucket: { out: { module: 'a', name: 'arn' } } },
      },
    ],
    { my_output: { out: { module: 'a', name: 'arn' } } },
    {
      'x@v1': {
        schema_version: '1.0',
        kind: 'module_def',
        id: 'x',
        version: 'v1',
        interface: { inputs: [], outputs: [] },
        impl: { kind: 'leaf', source: { kind: 'registry', ref: 'x/aws/v1' } },
      },
    },
  );
  expect(validateWorkspace(ws)).toHaveLength(0);
});

test('catches duplicate instance IDs', () => {
  const ws = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    { kind: 'module', id: 'a', use: { module_id: 'y', version: 'v1' }, inputs: {} },
  ]);
  const errors = validateWorkspace(ws);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.some((e) => e.message.includes('Duplicate instance ID'))).toBe(true);
});

test('catches out bindings referencing unknown instances', () => {
  const ws = makeWorkspace([
    {
      kind: 'module',
      id: 'b',
      use: { module_id: 'x', version: 'v1' },
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
      kind: 'module',
      id: 'a',
      use: { module_id: 'x', version: 'v1' },
      inputs: {},
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
      kind: 'module',
      id: 'a',
      use: { module_id: 'missing-module', version: 'v9.9.9' },
      inputs: {},
    },
  ]);
  const errors = validateWorkspace(ws);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.some((e) => e.message.includes('unknown module'))).toBe(true);
});

test('depends_on with module. prefix referencing valid instance produces no error', () => {
  const ws = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'b',
      use: { module_id: 'x', version: 'v1' },
      inputs: {},
      depends_on: ['module.a'],
    },
  ]);
  const errors = validateWorkspace(ws);
  expect(errors.filter((e) => e.message.includes('depends_on'))).toHaveLength(0);
});

test('depends_on with module. prefix referencing unknown instance catches error', () => {
  const ws = makeWorkspace([
    {
      kind: 'module',
      id: 'a',
      use: { module_id: 'x', version: 'v1' },
      inputs: {},
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
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    { kind: 'module', id: 'a', use: { module_id: 'y', version: 'v1' }, inputs: {} }, // duplicate
    {
      kind: 'module',
      id: 'b',
      use: { module_id: 'missing-mod', version: 'v1' },
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
    [{ kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} }],
    { bad_export: { out: { module: 'nonexistent', name: 'arn' } } },
  );
  const errors = validateWorkspace(ws);
  expect(errors.length).toBeGreaterThan(0);
  expect(
    errors.some((e) => e.message.includes('Export') && e.message.includes('nonexistent')),
  ).toBe(true);
});
