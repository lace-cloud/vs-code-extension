import { test, expect } from 'vitest';
import { fromBundle, toBundle } from '../utils/bundle';
import type { Bundle } from '../types/ir';
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

test('toBundle preserves out bindings', () => {
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
