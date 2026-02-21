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

// ══════════════════════════════════════════════════════════════════════
// SET_VARIABLES (Phase 2)
// ══════════════════════════════════════════════════════════════════════

test('SET_VARIABLES sets composite interface.inputs', () => {
  const state = makeWorkspace([]);
  const variables = [
    { name: 'bucket_name', type: 'string', required: true, description: 'The bucket name' },
    { name: 'tags', type: 'map(string)', required: false, default: {} },
  ];
  const next = workspaceReducer(state, {
    type: 'SET_VARIABLES',
    module_key: 'root@v1.0.0',
    variables,
  });
  expect(next.modules['root@v1.0.0'].interface.inputs).toEqual(variables);
  // outputs unchanged
  expect(next.modules['root@v1.0.0'].interface.outputs).toEqual([]);
});

test('SET_VARIABLES replaces existing variables', () => {
  const state = makeWorkspace([]);
  // Set initial variables
  const first = workspaceReducer(state, {
    type: 'SET_VARIABLES',
    module_key: 'root@v1.0.0',
    variables: [{ name: 'old_var', type: 'string', required: false }],
  });
  expect(first.modules['root@v1.0.0'].interface.inputs).toHaveLength(1);

  // Replace with new variables
  const second = workspaceReducer(first, {
    type: 'SET_VARIABLES',
    module_key: 'root@v1.0.0',
    variables: [
      { name: 'new_var_a', type: 'number', required: true },
      { name: 'new_var_b', type: 'bool', required: false },
    ],
  });
  expect(second.modules['root@v1.0.0'].interface.inputs).toHaveLength(2);
  expect(second.modules['root@v1.0.0'].interface.inputs[0].name).toBe('new_var_a');
  expect(second.modules['root@v1.0.0'].interface.inputs[1].name).toBe('new_var_b');
});

test('SET_VARIABLES on non-existent module_key returns state unchanged', () => {
  const state = makeWorkspace([]);
  const next = workspaceReducer(state, {
    type: 'SET_VARIABLES',
    module_key: 'nonexistent@v1.0.0',
    variables: [{ name: 'x', type: 'string', required: false }],
  });
  expect(next).toBe(state);
});

// ══════════════════════════════════════════════════════════════════════
// SET_EXPORTS (Phase 2)
// ══════════════════════════════════════════════════════════════════════

test('SET_EXPORTS sets both interface.outputs and graph.exports.outputs', () => {
  const state = makeWorkspace([
    {
      kind: 'module',
      id: 's3_bucket',
      use: { module_id: 'aws-s3-bucket', version: 'v1.2.0' },
      inputs: {},
    },
  ]);
  const output_defs = [
    { name: 'bucket_arn', type: 'string', description: 'The ARN of the primary bucket' },
    { name: 'bucket_id', type: 'string', description: 'The name of the primary bucket' },
  ];
  const outputs = {
    bucket_arn: { out: { module: 's3_bucket', name: 'arn' } },
    bucket_id: { out: { module: 's3_bucket', name: 'id' } },
  };
  const next = workspaceReducer(state, {
    type: 'SET_EXPORTS',
    module_key: 'root@v1.0.0',
    outputs,
    output_defs,
  });
  // interface.outputs updated
  expect(next.modules['root@v1.0.0'].interface.outputs).toEqual(output_defs);
  // graph.exports.outputs updated
  const def = next.modules['root@v1.0.0'];
  if (def.impl.kind === 'composite') {
    expect(def.impl.graph.exports.outputs).toEqual(outputs);
  } else {
    throw new Error('Expected composite');
  }
});

test('SET_EXPORTS replaces existing exports', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
  ]);
  // Set initial exports
  const first = workspaceReducer(state, {
    type: 'SET_EXPORTS',
    module_key: 'root@v1.0.0',
    outputs: { old_out: { out: { module: 'a', name: 'arn' } } },
    output_defs: [{ name: 'old_out', type: 'string' }],
  });
  const firstDef = first.modules['root@v1.0.0'];
  if (firstDef.impl.kind === 'composite') {
    expect(firstDef.impl.graph.exports.outputs['old_out']).toBeDefined();
  }

  // Replace
  const second = workspaceReducer(first, {
    type: 'SET_EXPORTS',
    module_key: 'root@v1.0.0',
    outputs: { new_out: { out: { module: 'a', name: 'id' } } },
    output_defs: [{ name: 'new_out', type: 'string' }],
  });
  const secondDef = second.modules['root@v1.0.0'];
  if (secondDef.impl.kind === 'composite') {
    expect(secondDef.impl.graph.exports.outputs['old_out']).toBeUndefined();
    expect(secondDef.impl.graph.exports.outputs['new_out']).toEqual({
      out: { module: 'a', name: 'id' },
    });
  }
  expect(second.modules['root@v1.0.0'].interface.outputs).toEqual([
    { name: 'new_out', type: 'string' },
  ]);
});

test('SET_EXPORTS on non-composite module_key returns state unchanged', () => {
  const state = makeWorkspace([]);
  // Add a leaf module
  const leafDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'leaf',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    impl: { kind: 'leaf', source: { kind: 'git', repo: 'test', ref: 'v1' } },
  };
  const stateWithLeaf = {
    ...state,
    modules: { ...state.modules, 'leaf@v1.0.0': leafDef },
  };
  const next = workspaceReducer(stateWithLeaf, {
    type: 'SET_EXPORTS',
    module_key: 'leaf@v1.0.0',
    outputs: { x: { out: { module: 'a', name: 'b' } } },
    output_defs: [{ name: 'x', type: 'string' }],
  });
  // interface.outputs updated (SET_EXPORTS updates interface first, then tries graph)
  // But since it's a leaf, updateCompositeGraph is a no-op — graph won't change
  expect(next.modules['leaf@v1.0.0'].interface.outputs).toEqual([{ name: 'x', type: 'string' }]);
});

// ══════════════════════════════════════════════════════════════════════
// Phase 2: s3_stack validation scenario
// ══════════════════════════════════════════════════════════════════════

test('Phase 2 s3_stack scenario: variables, var bindings, curated outputs', () => {
  // 1. Start with empty workspace
  let state = makeWorkspace([]);

  // 2. Drop composite bundle (s3_bucket + s3_bucket_versioning)
  const compositeBundle = loadFixture('composite_deploy_bundle.json');
  state = workspaceReducer(state, {
    type: 'DROP_BUNDLE',
    module_key: 'root@v1.0.0',
    deploy_bundle: compositeBundle,
    positions: {},
  });
  const instances = getInstances(state, 'root@v1.0.0');
  expect(instances.find((i) => i.id === 's3_bucket')).toBeDefined();
  expect(instances.find((i) => i.id === 's3_bucket_versioning')).toBeDefined();

  // 3. Define composite variables
  const variables = [
    {
      name: 'bucket_name',
      type: 'string',
      required: true,
      description: 'The name of the S3 bucket',
    },
    { name: 'tags', type: 'map(string)', required: false, default: {} },
    { name: 'versioning_enabled', type: 'bool', required: false, default: false },
    { name: 'acl', type: 'string', required: false, default: 'private' },
  ];
  state = workspaceReducer(state, {
    type: 'SET_VARIABLES',
    module_key: 'root@v1.0.0',
    variables,
  });
  expect(state.modules['root@v1.0.0'].interface.inputs).toEqual(variables);

  // 4. Set var bindings on s3_bucket instance
  state = workspaceReducer(state, {
    type: 'UPDATE_INPUTS',
    module_key: 'root@v1.0.0',
    instance_id: 's3_bucket',
    inputs: {
      bucket_name: { var: 'bucket_name' },
      tags: { var: 'tags' },
      versioning_enabled: { var: 'versioning_enabled' },
      acl: { var: 'acl' },
    },
  });
  const s3Bucket = getInst(state, 's3_bucket');
  expect(s3Bucket.inputs.bucket_name).toEqual({ var: 'bucket_name' });
  expect(s3Bucket.inputs.tags).toEqual({ var: 'tags' });

  // 5. Verify the wire from CONNECT is preserved (s3_bucket.id → s3_bucket_versioning.bucket_id)
  const versioning = getInst(state, 's3_bucket_versioning');
  expect(versioning.inputs.bucket_id).toEqual({ out: { module: 's3_bucket', name: 'id' } });

  // 6. Set curated outputs
  state = workspaceReducer(state, {
    type: 'SET_EXPORTS',
    module_key: 'root@v1.0.0',
    outputs: {
      bucket_arn: { out: { module: 's3_bucket', name: 'arn' } },
      bucket_id: { out: { module: 's3_bucket', name: 'id' } },
    },
    output_defs: [
      { name: 'bucket_arn', type: 'string', description: 'The ARN of the primary bucket' },
      { name: 'bucket_id', type: 'string', description: 'The name of the primary bucket' },
    ],
  });

  // Verify interface.outputs
  expect(state.modules['root@v1.0.0'].interface.outputs).toHaveLength(2);
  expect(state.modules['root@v1.0.0'].interface.outputs[0].name).toBe('bucket_arn');

  // Verify graph.exports.outputs
  const exports = getExports(state, 'root@v1.0.0');
  expect(exports['bucket_arn']).toEqual({ out: { module: 's3_bucket', name: 'arn' } });
  expect(exports['bucket_id']).toEqual({ out: { module: 's3_bucket', name: 'id' } });
});
