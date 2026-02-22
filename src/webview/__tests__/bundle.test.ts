import { test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fromBundle, toBundle } from '../utils/bundle';
import type { ModuleBundle } from '../types/ir';

function loadFixture(name: string): any {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

/**
 * normalizeBundle: deterministic comparison helper.
 * - Sorts module keys
 * - Sorts instance arrays by id
 * - Sorts wire arrays by from.module + from.port
 * - Normalizes instance kind (absent/empty → 'module')
 * - Removes undefined optional fields for clean comparison
 */
function normalizeBundle(bundle: any): any {
  const clone = JSON.parse(JSON.stringify(bundle));

  // Sort module keys
  const sortedModules: Record<string, any> = {};
  for (const key of Object.keys(clone.modules).sort()) {
    const mod = clone.modules[key];
    if (mod.impl?.kind === 'composite' && mod.impl.graph) {
      const graph = mod.impl.graph;

      // Normalize instance kind
      if (graph.instances) {
        graph.instances = graph.instances.map((inst: any) => {
          if (!inst.kind || inst.kind === '') {
            inst.kind = 'module';
          }
          return inst;
        });
        // Sort instances by id
        graph.instances.sort((a: any, b: any) => a.id.localeCompare(b.id));
      }

      // Sort wires
      if (graph.wires) {
        graph.wires.sort((a: any, b: any) => {
          const aKey = `${a.from.module}:${a.from.port}`;
          const bKey = `${b.from.module}:${b.from.port}`;
          return aKey.localeCompare(bKey);
        });
      }
    }
    sortedModules[key] = mod;
  }
  clone.modules = sortedModules;

  return clone;
}

test('round-trip: leaf deploy_bundle', () => {
  const original = loadFixture('leaf_deploy_bundle.json');
  const { workspace, errors } = fromBundle(original);
  expect(errors).toHaveLength(0);
  const exported = toBundle(workspace);
  expect(normalizeBundle(exported)).toEqual(normalizeBundle(original));
});

test('round-trip: composite deploy_bundle', () => {
  const original = loadFixture('composite_deploy_bundle.json');
  const { workspace, errors } = fromBundle(original);
  expect(errors).toHaveLength(0);
  const exported = toBundle(workspace);
  expect(normalizeBundle(exported)).toEqual(normalizeBundle(original));
});

test('round-trip: full bundle with terraform', () => {
  const original = loadFixture('full_bundle_with_terraform.json');
  const { workspace, errors } = fromBundle(original);
  expect(errors).toHaveLength(0);
  const exported = toBundle(workspace);
  expect(normalizeBundle(exported)).toEqual(normalizeBundle(original));
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
        impl: {
          kind: 'composite',
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
    },
  };
  const { workspace } = fromBundle(bundle);
  const def = workspace.modules['test@v1'];
  if (def.impl.kind === 'composite') {
    expect(def.impl.graph.instances[0].kind).toBe('module');
  }
});

test('fromBundle strips wires from graph', () => {
  const original = loadFixture('composite_deploy_bundle.json');
  const { workspace } = fromBundle(original);
  const entryKey = `${original.entry.module_id}@${original.entry.version}`;
  const def = workspace.modules[entryKey];
  if (def.impl.kind === 'composite') {
    expect(def.impl.graph.wires).toBeUndefined();
  }
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
        impl: {
          kind: 'composite',
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
    },
  };
  const { workspace } = fromBundle(bundle);
  const exported = toBundle(workspace);
  const def = exported.modules['test@v1'];
  if (def.impl.kind === 'composite') {
    expect(def.impl.graph.wires).toHaveLength(1);
    expect(def.impl.graph.wires![0]).toEqual({
      from: { module: 'a', port: 'outputs.arn' },
      to: { module: 'b', port: 'inputs.bucket' },
    });
  }
});
