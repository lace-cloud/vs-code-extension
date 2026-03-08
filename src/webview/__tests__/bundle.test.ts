import { test, expect } from 'vitest';
import { fromBundle, toBundle } from '../utils/bundle';
import type { Bundle } from '../types/ir';
import { allChildren } from '../utils/children';
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

test('fromBundle normalizes legacy instance kind: empty → module Use', () => {
  const bundle: Bundle = {
    schema_version: '1.0',
    kind: 'bundle',
    entry: 'test@v1',
    modules: {
      'test@v1': {
        id: 'test',
        version: 'v1',
        interface: { inputs: [], outputs: [] },
        graph: {
          instances: [
            {
              id: 'a',
              // kind intentionally missing — legacy format
              use: { module_id: 'x', version: 'v1' },
              inputs: {},
            },
          ],
          wires: [],
          exports: { outputs: {} },
        },
      } as any,
    },
  };
  const { workspace } = fromBundle(bundle);
  const def = workspace.modules['test@v1'];
  // Legacy instance with use.module_id should become a Use with module key
  const children = allChildren(def);
  expect(children).toHaveLength(1);
  expect('module' in children[0]).toBe(true);
  expect((children[0] as any).module).toBe('x@v1');
});

test('fromBundle strips wires from graph', () => {
  const original = loadFixture('composite_deploy_bundle.json');
  const { workspace } = fromBundle(original);
  const entryKey = workspace.entry;
  const def = workspace.modules[entryKey];
  // New format has no graph/wires — modules and resources are top-level
  expect((def as any).graph).toBeUndefined();
});

test('toBundle injects wires from out bindings', () => {
  const bundle: Bundle = {
    schema_version: '1.0',
    kind: 'bundle',
    entry: 'test@v1',
    modules: {
      'test@v1': {
        id: 'test',
        version: 'v1',
        interface: { inputs: [], outputs: [] },
        modules: [
          {
            id: 'a',
            module: 'x@v1',
          },
          {
            id: 'b',
            module: 'y@v1',
            inputs: {
              bucket: { out: { module: 'a', name: 'arn' } },
            },
          },
        ],
        exports: { outputs: {} },
      },
    },
  };
  const { workspace } = fromBundle(bundle);
  const exported = toBundle(workspace);
  const def = exported.modules['test@v1'];
  // toBundle should produce the wire-format Module — check modules array has the binding
  const bChild = def.modules?.find((u) => u.id === 'b');
  expect(bChild).toBeDefined();
  expect(bChild!.inputs!.bucket).toEqual({ out: { module: 'a', name: 'arn' } });
});
