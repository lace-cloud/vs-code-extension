import { test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { workspaceReducer } from '../state/reducer';
import type { WorkspaceState } from '../types/workspace';
import type { Instance, ModuleDef } from '../types/ir';

function loadFixture(name: string): any {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

/** Build a minimal workspace with one composite and some instances */
function makeWorkspace(
  instances: Instance[],
  modules: Record<string, ModuleDef> = {},
  layouts: Record<string, any> = {},
): WorkspaceState {
  const moduleKey = 'root@v1.0.0';
  const rootDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'root',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    impl: {
      kind: 'composite',
      graph: {
        instances,
        exports: { outputs: {} },
      },
    },
  };
  return {
    schema_version: '1.0',
    kind: 'module_bundle',
    entry: { module_id: 'root', version: 'v1.0.0' },
    modules: { [moduleKey]: rootDef, ...modules },
    layouts: {
      [moduleKey]: layouts[moduleKey] || { nodes: {} },
      ...layouts,
    },
  };
}

/** Get an instance from the root composite */
function getInst(state: WorkspaceState, id: string): Instance {
  const def = state.modules['root@v1.0.0'];
  if (def.impl.kind !== 'composite') {
    throw new Error('Not composite');
  }
  const inst = def.impl.graph.instances.find((i) => i.id === id);
  if (!inst) {
    throw new Error(`Instance ${id} not found`);
  }
  return inst;
}

/** Get all instances from the root composite */
function getInstances(state: WorkspaceState, key: string): Instance[] {
  const def = state.modules[key];
  if (def.impl.kind !== 'composite') {
    throw new Error('Not composite');
  }
  return def.impl.graph.instances;
}

/** Get exports from the root composite */
function getExports(state: WorkspaceState, key: string) {
  const def = state.modules[key];
  if (def.impl.kind !== 'composite') {
    throw new Error('Not composite');
  }
  return def.impl.graph.exports.outputs;
}

// ══════════════════════════════════════════════════════════════════════
// CONNECT
// ══════════════════════════════════════════════════════════════════════

test('CONNECT sets out binding on target', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    { kind: 'module', id: 'b', use: { module_id: 'y', version: 'v1' }, inputs: {} },
  ]);
  const next = workspaceReducer(state, {
    type: 'CONNECT',
    module_key: 'root@v1.0.0',
    source_instance: 'a',
    target_instance: 'b',
    mapping: { from: 'arn', to: 'bucket' },
  });
  const b = getInst(next, 'b');
  expect(b.inputs.bucket).toEqual({ out: { module: 'a', name: 'arn' } });
});

// ══════════════════════════════════════════════════════════════════════
// DISCONNECT
// ══════════════════════════════════════════════════════════════════════

test('DISCONNECT removes binding', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'b',
      use: { module_id: 'y', version: 'v1' },
      inputs: { bucket: { out: { module: 'a', name: 'arn' } } },
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'DISCONNECT',
    module_key: 'root@v1.0.0',
    target_instance: 'b',
    input_name: 'bucket',
  });
  const b = getInst(next, 'b');
  expect(b.inputs.bucket).toBeUndefined();
});

// ══════════════════════════════════════════════════════════════════════
// RENAME_INSTANCE
// ══════════════════════════════════════════════════════════════════════

test('RENAME_INSTANCE cascades to sibling out bindings', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'b',
      use: { module_id: 'y', version: 'v1' },
      inputs: { bucket: { out: { module: 'a', name: 'arn' } } },
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'RENAME_INSTANCE',
    module_key: 'root@v1.0.0',
    old_id: 'a',
    new_id: 'vpc',
  });
  const b = getInst(next, 'b');
  expect(b.inputs.bucket).toEqual({ out: { module: 'vpc', name: 'arn' } });
  // Original name gone
  expect(() => getInst(next, 'a')).toThrow();
  // New name exists
  expect(getInst(next, 'vpc')).toBeDefined();
});

test('RENAME_INSTANCE cascades to exports', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
  ]);
  // Manually set exports referencing 'a'
  const def = state.modules['root@v1.0.0'];
  if (def.impl.kind === 'composite') {
    def.impl.graph.exports.outputs['role_arn'] = {
      out: { module: 'a', name: 'arn' },
    };
  }

  const next = workspaceReducer(state, {
    type: 'RENAME_INSTANCE',
    module_key: 'root@v1.0.0',
    old_id: 'a',
    new_id: 'vpc',
  });
  const exports = getExports(next, 'root@v1.0.0');
  expect(exports['role_arn']).toEqual({ out: { module: 'vpc', name: 'arn' } });
});

test('RENAME_INSTANCE cascades to sibling depends_on', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'c',
      use: { module_id: 'z', version: 'v1' },
      inputs: {},
      depends_on: ['a'],
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'RENAME_INSTANCE',
    module_key: 'root@v1.0.0',
    old_id: 'a',
    new_id: 'vpc',
  });
  const c = getInst(next, 'c');
  expect(c.depends_on).toEqual(['vpc']);
});

test('RENAME_INSTANCE cascades to layout key', () => {
  const state = makeWorkspace(
    [{ kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} }],
    {},
    { 'root@v1.0.0': { nodes: { a: { position: { x: 100, y: 200 } } } } },
  );
  const next = workspaceReducer(state, {
    type: 'RENAME_INSTANCE',
    module_key: 'root@v1.0.0',
    old_id: 'a',
    new_id: 'vpc',
  });
  const layout = next.layouts['root@v1.0.0'];
  expect(layout.nodes['vpc']).toEqual({ position: { x: 100, y: 200 } });
  expect(layout.nodes['a']).toBeUndefined();
});

// ══════════════════════════════════════════════════════════════════════
// DELETE_INSTANCE
// ══════════════════════════════════════════════════════════════════════

test('DELETE_INSTANCE removes from graph and layout', () => {
  const state = makeWorkspace(
    [{ kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} }],
    {},
    { 'root@v1.0.0': { nodes: { a: { position: { x: 100, y: 200 } } } } },
  );
  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'a',
  });
  expect(getInstances(next, 'root@v1.0.0')).toHaveLength(0);
  expect(next.layouts['root@v1.0.0'].nodes['a']).toBeUndefined();
});

test('DELETE_INSTANCE cleans up sibling out bindings referencing deleted instance', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'b',
      use: { module_id: 'y', version: 'v1' },
      inputs: { bucket: { out: { module: 'a', name: 'arn' } } },
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'a',
  });
  const b = getInst(next, 'b');
  expect(b.inputs.bucket).toBeUndefined();
});

test('DELETE_INSTANCE cleans up exports referencing deleted instance', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
  ]);
  const def = state.modules['root@v1.0.0'];
  if (def.impl.kind === 'composite') {
    def.impl.graph.exports.outputs['role_arn'] = {
      out: { module: 'a', name: 'arn' },
    };
  }
  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'a',
  });
  const exports = getExports(next, 'root@v1.0.0');
  expect(exports['role_arn']).toBeUndefined();
});

test('DELETE_INSTANCE cleans up sibling depends_on referencing deleted instance', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'c',
      use: { module_id: 'z', version: 'v1' },
      inputs: {},
      depends_on: ['a'],
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'a',
  });
  const c = getInst(next, 'c');
  // depends_on should be removed (empty array removed)
  expect(c.depends_on).toBeUndefined();
});

// ══════════════════════════════════════════════════════════════════════
// DROP_BUNDLE
// ══════════════════════════════════════════════════════════════════════

test('DROP_BUNDLE merges all non-entry modules and inlines instances', () => {
  const state = makeWorkspace([]);
  const deploy_bundle = loadFixture('leaf_deploy_bundle.json');
  const next = workspaceReducer(state, {
    type: 'DROP_BUNDLE',
    module_key: 'root@v1.0.0',
    deploy_bundle,
    positions: { 'aws-s3-bucket': { x: 100, y: 100 } },
  });
  // Verify: leaf ModuleDef merged into modules
  expect(next.modules['aws-s3-bucket@v1.2.0']).toBeDefined();
  // Verify: instance inlined
  const instances = getInstances(next, 'root@v1.0.0');
  expect(instances.find((i) => i.id === 'aws-s3-bucket')).toBeDefined();
  // Verify: entry wrapper NOT in modules
  expect(next.modules['deploy-aws-s3-bucket@v1.2.0']).toBeUndefined();
});

test('DROP_BUNDLE works identically for leaf and composite bundles', () => {
  // Drop leaf fixture
  let state = makeWorkspace([]);
  const leafBundle = loadFixture('leaf_deploy_bundle.json');
  const afterLeaf = workspaceReducer(state, {
    type: 'DROP_BUNDLE',
    module_key: 'root@v1.0.0',
    deploy_bundle: leafBundle,
    positions: {},
  });
  const leafInstances = getInstances(afterLeaf, 'root@v1.0.0');
  expect(leafInstances.length).toBeGreaterThan(0);

  // Drop composite fixture
  state = makeWorkspace([]);
  const compositeBundle = loadFixture('composite_deploy_bundle.json');
  const afterComposite = workspaceReducer(state, {
    type: 'DROP_BUNDLE',
    module_key: 'root@v1.0.0',
    deploy_bundle: compositeBundle,
    positions: {},
  });
  const compositeInstances = getInstances(afterComposite, 'root@v1.0.0');
  expect(compositeInstances.length).toBeGreaterThan(0);

  // Both went through same code path — no branching on module kind
});

test('DROP_BUNDLE preserves intermediate composites from nested bundles', () => {
  const state = makeWorkspace([]);
  const deploy_bundle = loadFixture('full_bundle_with_terraform.json');
  const next = workspaceReducer(state, {
    type: 'DROP_BUNDLE',
    module_key: 'root@v1.0.0',
    deploy_bundle,
    positions: {},
  });
  // All non-entry modules should be present
  expect(next.modules['aws-iam-role@v2.0.0']).toBeDefined();
  expect(next.modules['aws-iam-policy@v1.0.0']).toBeDefined();
  expect(next.modules['aws-iam-role-policy-attachment@v1.0.0']).toBeDefined();
  // Entry wrapper should NOT be present
  expect(next.modules['iam-stack@v1.0.0']).toBeUndefined();
});

test('DROP_BUNDLE handles collision with _1 suffix', () => {
  // Pre-populate workspace with instance id 'aws-s3-bucket'
  const state = makeWorkspace([
    {
      kind: 'module',
      id: 'aws-s3-bucket',
      use: { module_id: 'aws-s3-bucket', version: 'v1.2.0' },
      inputs: {},
    },
  ]);
  const deploy_bundle = loadFixture('leaf_deploy_bundle.json');
  const next = workspaceReducer(state, {
    type: 'DROP_BUNDLE',
    module_key: 'root@v1.0.0',
    deploy_bundle,
    positions: {},
  });
  const instances = getInstances(next, 'root@v1.0.0');
  // Original should still exist
  expect(instances.find((i) => i.id === 'aws-s3-bucket')).toBeDefined();
  // New one should have _1 suffix
  expect(instances.find((i) => i.id === 'aws-s3-bucket_1')).toBeDefined();
});

// ══════════════════════════════════════════════════════════════════════
// LOAD_WORKSPACE
// ══════════════════════════════════════════════════════════════════════

test('LOAD_WORKSPACE replaces entire state', () => {
  const state = makeWorkspace([]);
  const newState = makeWorkspace([
    { kind: 'module', id: 'x', use: { module_id: 'a', version: 'v1' }, inputs: {} },
  ]);
  const next = workspaceReducer(state, { type: 'LOAD_WORKSPACE', workspace: newState });
  expect(next).toBe(newState); // reference equality — full replacement
});

// ══════════════════════════════════════════════════════════════════════
// UPDATE_INPUTS
// ══════════════════════════════════════════════════════════════════════

test('UPDATE_INPUTS replaces entire inputs on target instance', () => {
  const state = makeWorkspace([
    {
      kind: 'module',
      id: 'a',
      use: { module_id: 'x', version: 'v1' },
      inputs: { old: { lit: 'value' } },
    },
  ]);
  const newInputs = { name: { lit: 'new-bucket' }, region: { var: 'aws_region' } };
  const next = workspaceReducer(state, {
    type: 'UPDATE_INPUTS',
    module_key: 'root@v1.0.0',
    instance_id: 'a',
    inputs: newInputs,
  });
  const a = getInst(next, 'a');
  expect(a.inputs).toEqual(newInputs);
  expect(a.inputs.old).toBeUndefined();
});

// ══════════════════════════════════════════════════════════════════════
// SYNC_LAYOUT
// ══════════════════════════════════════════════════════════════════════

test('SYNC_LAYOUT bulk-replaces positions', () => {
  const state = makeWorkspace(
    [{ kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} }],
    {},
    { 'root@v1.0.0': { nodes: { a: { position: { x: 0, y: 0 } } } } },
  );
  const next = workspaceReducer(state, {
    type: 'SYNC_LAYOUT',
    module_key: 'root@v1.0.0',
    positions: { a: { x: 500, y: 300 } },
  });
  expect(next.layouts['root@v1.0.0'].nodes['a']).toEqual({
    position: { x: 500, y: 300 },
  });
});
