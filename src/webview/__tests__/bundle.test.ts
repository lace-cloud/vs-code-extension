import { test, expect } from 'vitest';
import { fromBundle, toBundle } from '../utils/bundle';
import type { ModuleBundle } from '../types/ir';
import { makeModuleKey } from '../utils/identifiers';
import { loadFixture } from './helpers';

test('round-trip: leaf deploy_bundle', () => {
  const original = loadFixture('leaf_deploy_bundle.json');
  const { workspace, errors } = fromBundle(original);
  expect(errors).toHaveLength(0);
  const exported = toBundle(workspace);
  const { workspace: reimported, errors: errors2 } = fromBundle(exported);
  expect(errors2).toHaveLength(0);
  expect(reimported.modules).toEqual(workspace.modules);
});

test('round-trip: composite deploy_bundle', () => {
  const original = loadFixture('composite_deploy_bundle.json');
  const { workspace, errors } = fromBundle(original);
  expect(errors).toHaveLength(0);
  const exported = toBundle(workspace);
  const { workspace: reimported, errors: errors2 } = fromBundle(exported);
  expect(errors2).toHaveLength(0);
  expect(reimported.modules).toEqual(workspace.modules);
});

test('round-trip: full bundle with terraform', () => {
  const original = loadFixture('full_bundle_with_terraform.json');
  const { workspace, errors } = fromBundle(original);
  expect(errors).toHaveLength(0);
  const exported = toBundle(workspace);
  const { workspace: reimported, errors: errors2 } = fromBundle(exported);
  expect(errors2).toHaveLength(0);
  expect(reimported.modules).toEqual(workspace.modules);
});

test('fromBundle collects errors for malformed modules without crashing', () => {
  const bundle = loadFixture('bundle_with_bad_module.json');
  const { workspace, errors } = fromBundle(bundle);
  expect(errors.length).toBeGreaterThan(0);
  expect(Object.keys(workspace.modules).length).toBeGreaterThan(0);
});

test('fromBundle normalizes instance kind: empty → module', () => {
  const bundle: ModuleBundle = {
    schema_version: '1.0',
    kind: 'module_bundle',
    entry: { module_id: 'test', version: 'v1' },
    modules: {
      'test@v1': {
        schema_version: '1.0',
        kind: 'module_def',
        id: 'test',
        version: 'v1',
        interface: { inputs: [], outputs: [] },
        graph: {
          instances: [
            {
              id: 'a',
              // kind intentionally missing
              use: { module_id: 'x', version: 'v1' },
              inputs: {},
            } as any,
          ],
          wires: [],
          exports: { outputs: {} },
        },
      },
    },
  };
  const { workspace } = fromBundle(bundle);
  const def = workspace.modules['test@v1'];
  expect(def.graph.instances[0].kind).toBe('module');
});

test('fromBundle strips wires from graph', () => {
  const original = loadFixture('composite_deploy_bundle.json');
  const { workspace } = fromBundle(original);
  const entryKey = makeModuleKey(original.entry.module_id, original.entry.version);
  const def = workspace.modules[entryKey];
  expect(def.graph.wires).toBeUndefined();
});

test('toBundle injects wires from out bindings', () => {
  const bundle: ModuleBundle = {
    schema_version: '1.0',
    kind: 'module_bundle',
    entry: { module_id: 'test', version: 'v1' },
    modules: {
      'test@v1': {
        schema_version: '1.0',
        kind: 'module_def',
        id: 'test',
        version: 'v1',
        interface: { inputs: [], outputs: [] },
        graph: {
          instances: [
            {
              kind: 'module' as const,
              id: 'a',
              use: { module_id: 'x', version: 'v1' },
              inputs: {},
            },
            {
              kind: 'module' as const,
              id: 'b',
              use: { module_id: 'y', version: 'v1' },
              inputs: {
                bucket: { out: { module: 'a', name: 'arn' } },
              },
            },
          ],
          exports: { outputs: {} },
        },
      },
    },
  };
  const { workspace } = fromBundle(bundle);
  const exported = toBundle(workspace);
  const def = exported.modules['test@v1'];
  expect(def.graph.wires).toHaveLength(1);
  expect(def.graph.wires![0]).toEqual({
    from: { module: 'a', port: 'outputs.arn' },
    to: { module: 'b', port: 'inputs.bucket' },
  });
});
