import { test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { workspaceReducer } from '../state/reducer';
import type { WorkspaceState } from '../types/workspace';
import type { Instance, ModuleDef, ModuleBundle } from '../types/ir';

function loadFixture(name: string): ModuleBundle {
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
    graph: {
      instances,
      exports: { outputs: {} },
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
  const inst = def.graph.instances.find((i) => i.id === id);
  if (!inst) {
    throw new Error(`Instance ${id} not found`);
  }
  return inst;
}

/** Get all instances from the root composite */
function getInstances(state: WorkspaceState, key: string): Instance[] {
  const def = state.modules[key];
  return def.graph.instances;
}

/** Get exports from the root composite */
function getExports(state: WorkspaceState, key: string) {
  const def = state.modules[key];
  return def.graph.exports.outputs;
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
  def.graph.exports.outputs['role_arn'] = {
    out: { module: 'a', name: 'arn' },
  };

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

test('RENAME_INSTANCE cascades to sibling depends_on with module. prefix', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'c',
      use: { module_id: 'z', version: 'v1' },
      inputs: {},
      depends_on: ['module.a'],
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'RENAME_INSTANCE',
    module_key: 'root@v1.0.0',
    old_id: 'a',
    new_id: 'vpc',
  });
  const c = getInst(next, 'c');
  expect(c.depends_on).toEqual(['module.vpc']);
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
  def.graph.exports.outputs['role_arn'] = {
    out: { module: 'a', name: 'arn' },
  };
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

test('DELETE_INSTANCE cleans up sibling depends_on with module. prefix', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'c',
      use: { module_id: 'z', version: 'v1' },
      inputs: {},
      depends_on: ['module.a', 'module.b'],
    },
    { kind: 'module', id: 'b', use: { module_id: 'y', version: 'v1' }, inputs: {} },
  ]);
  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'a',
  });
  const c = getInst(next, 'c');
  // module.a removed, module.b preserved
  expect(c.depends_on).toEqual(['module.b']);
});

test('DELETE_INSTANCE removes orphaned module defs from state.modules', () => {
  const leafDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'rds-instance',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    graph: { instances: [], exports: { outputs: {} } },
  };
  const state = makeWorkspace(
    [
      {
        kind: 'module',
        id: 'my-rds',
        use: { module_id: 'rds-instance', version: 'v1.0.0' },
        inputs: {},
      },
    ],
    { 'rds-instance@v1.0.0': leafDef },
  );
  // Module def exists before delete
  expect(state.modules['rds-instance@v1.0.0']).toBeDefined();

  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'my-rds',
  });
  // Instance removed
  expect(getInstances(next, 'root@v1.0.0')).toHaveLength(0);
  // Orphaned module def cleaned up
  expect(next.modules['rds-instance@v1.0.0']).toBeUndefined();
  // Root composite preserved
  expect(next.modules['root@v1.0.0']).toBeDefined();
});

test('DELETE_INSTANCE preserves module defs still referenced by other instances', () => {
  const leafDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'vpc',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    graph: { instances: [], exports: { outputs: {} } },
  };
  const state = makeWorkspace(
    [
      {
        kind: 'module',
        id: 'vpc-1',
        use: { module_id: 'vpc', version: 'v1.0.0' },
        inputs: {},
      },
      {
        kind: 'module',
        id: 'vpc-2',
        use: { module_id: 'vpc', version: 'v1.0.0' },
        inputs: {},
      },
    ],
    { 'vpc@v1.0.0': leafDef },
  );

  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'vpc-1',
  });
  // vpc-2 still references the module def — must be preserved
  expect(next.modules['vpc@v1.0.0']).toBeDefined();
  expect(getInstances(next, 'root@v1.0.0')).toHaveLength(1);
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

test('DROP_BUNDLE preserves existing node layout positions', () => {
  const state = makeWorkspace(
    [
      {
        kind: 'module',
        id: 'existing-node',
        use: { module_id: 'aws-s3-bucket', version: 'v1.2.0' },
        inputs: {},
      },
    ],
    {},
    { 'root@v1.0.0': { nodes: { 'existing-node': { position: { x: 42, y: 84 } } } } },
  );
  const deploy_bundle = loadFixture('leaf_deploy_bundle.json');
  const next = workspaceReducer(state, {
    type: 'DROP_BUNDLE',
    module_key: 'root@v1.0.0',
    deploy_bundle,
    positions: { 'aws-s3-bucket': { x: 200, y: 300 } },
  });
  // Existing node position preserved
  expect(next.layouts['root@v1.0.0'].nodes['existing-node']).toEqual({
    position: { x: 42, y: 84 },
  });
  // New node has its drop position
  const newId = getInstances(next, 'root@v1.0.0').find((i) => i.id !== 'existing-node')!.id;
  expect(next.layouts['root@v1.0.0'].nodes[newId]).toBeDefined();
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
  // No orphans → GC returns same reference
  expect(next).toBe(newState);
});

test('LOAD_WORKSPACE removes orphaned module defs not referenced by any instance', () => {
  const referencedDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'vpc',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    graph: { instances: [], exports: { outputs: {} } },
  };
  const orphanDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'rds-instance',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    graph: { instances: [], exports: { outputs: {} } },
  };
  // Simulate loading a lace.json that has orphaned defs from earlier bugs
  const dirtyState = makeWorkspace(
    [{ kind: 'module', id: 'my-vpc', use: { module_id: 'vpc', version: 'v1.0.0' }, inputs: {} }],
    { 'vpc@v1.0.0': referencedDef, 'rds-instance@v1.0.0': orphanDef },
  );

  const next = workspaceReducer(makeWorkspace([]), {
    type: 'LOAD_WORKSPACE',
    workspace: dirtyState,
  });
  // Orphan removed by GC on load
  expect(next.modules['rds-instance@v1.0.0']).toBeUndefined();
  // Referenced def and root preserved
  expect(next.modules['vpc@v1.0.0']).toBeDefined();
  expect(next.modules['root@v1.0.0']).toBeDefined();
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

test('SYNC_LAYOUT merges with existing positions (does not clobber siblings)', () => {
  const state = makeWorkspace(
    [
      { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
      { kind: 'module', id: 'b', use: { module_id: 'y', version: 'v1' }, inputs: {} },
      { kind: 'module', id: 'c', use: { module_id: 'z', version: 'v1' }, inputs: {} },
    ],
    {},
    {
      'root@v1.0.0': {
        nodes: {
          a: { position: { x: 10, y: 20 } },
          b: { position: { x: 30, y: 40 } },
          c: { position: { x: 50, y: 60 } },
        },
      },
    },
  );
  // Only drag node 'b' — a and c must survive
  const next = workspaceReducer(state, {
    type: 'SYNC_LAYOUT',
    module_key: 'root@v1.0.0',
    positions: { b: { x: 999, y: 888 } },
  });
  expect(next.layouts['root@v1.0.0'].nodes['a']).toEqual({ position: { x: 10, y: 20 } });
  expect(next.layouts['root@v1.0.0'].nodes['b']).toEqual({ position: { x: 999, y: 888 } });
  expect(next.layouts['root@v1.0.0'].nodes['c']).toEqual({ position: { x: 50, y: 60 } });
});

test('SYNC_LAYOUT adds positions for nodes not yet in layout', () => {
  const state = makeWorkspace(
    [{ kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} }],
    {},
    {}, // empty layout (makeWorkspace creates { nodes: {} } for root)
  );
  // Verify node 'a' has no position yet
  expect(state.layouts['root@v1.0.0'].nodes['a']).toBeUndefined();
  const next = workspaceReducer(state, {
    type: 'SYNC_LAYOUT',
    module_key: 'root@v1.0.0',
    positions: { a: { x: 100, y: 200 } },
  });
  expect(next.layouts['root@v1.0.0'].nodes['a']).toEqual({ position: { x: 100, y: 200 } });
});

// ══════════════════════════════════════════════════════════════════════
// SET_VARIABLES
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
// SET_EXPORTS
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
  expect(def.graph.exports.outputs).toEqual(outputs);
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
  expect(firstDef.graph.exports.outputs['old_out']).toBeDefined();

  // Replace
  const second = workspaceReducer(first, {
    type: 'SET_EXPORTS',
    module_key: 'root@v1.0.0',
    outputs: { new_out: { out: { module: 'a', name: 'id' } } },
    output_defs: [{ name: 'new_out', type: 'string' }],
  });
  const secondDef = second.modules['root@v1.0.0'];
  expect(secondDef.graph.exports.outputs['old_out']).toBeUndefined();
  expect(secondDef.graph.exports.outputs['new_out']).toEqual({
    out: { module: 'a', name: 'id' },
  });
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
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    graph: { instances: [], exports: { outputs: {} } },
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
// REFRESH_MODULE_DEFS
// ══════════════════════════════════════════════════════════════════════

test('REFRESH_MODULE_DEFS merges updated defs, preserves instance inputs and root composite', () => {
  const leafDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'aws-s3-bucket',
    version: 'v1.2.0',
    interface: {
      inputs: [{ name: 'bucket_name', type: 'string', required: true }],
      outputs: [{ name: 'arn', type: 'string' }],
    },
    source: { kind: 'git', repo: 'old-repo', ref: 'v1.2.0' },
    graph: { instances: [], exports: { outputs: {} } },
  };
  const state = makeWorkspace(
    [
      {
        kind: 'module',
        id: 's3',
        use: { module_id: 'aws-s3-bucket', version: 'v1.2.0' },
        inputs: { bucket_name: { lit: 'my-bucket' } },
      },
    ],
    { 'aws-s3-bucket@v1.2.0': leafDef },
  );

  // Updated def: fixed git URL
  const updatedDef: ModuleDef = {
    ...leafDef,
    interface: {
      inputs: [
        { name: 'bucket_name', type: 'string', required: true },
        { name: 'tags', type: 'map(string)', required: false },
      ],
      outputs: [{ name: 'arn', type: 'string' }],
    },
    source: { kind: 'git', repo: 'fixed-repo', ref: 'v1.2.0' },
    graph: { instances: [], exports: { outputs: {} } },
  };

  const next = workspaceReducer(state, {
    type: 'REFRESH_MODULE_DEFS',
    updated_modules: { 'aws-s3-bucket@v1.2.0': updatedDef },
  });

  // Module def is updated
  const def = next.modules['aws-s3-bucket@v1.2.0'];
  expect((def.source as any).repo).toBe('fixed-repo');
  expect(def.interface.inputs).toHaveLength(2);

  // Root composite preserved
  expect(next.modules['root@v1.0.0']).toBeDefined();
  expect(next.modules['root@v1.0.0'].graph).toBeDefined();

  // Instance inputs preserved
  const s3 = getInst(next, 's3');
  expect(s3.inputs.bucket_name).toEqual({ lit: 'my-bucket' });
});

test('REFRESH_MODULE_DEFS with empty map returns same state reference', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
  ]);
  const next = workspaceReducer(state, {
    type: 'REFRESH_MODULE_DEFS',
    updated_modules: {},
  });
  expect(next).toBe(state); // reference equality — no re-render
});

test('REFRESH_MODULE_DEFS preserves layouts', () => {
  const leafDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'vpc',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'old', ref: 'v1' },
    graph: { instances: [], exports: { outputs: {} } },
  };
  const state = makeWorkspace(
    [
      {
        kind: 'module',
        id: 'my-vpc',
        use: { module_id: 'vpc', version: 'v1.0.0' },
        inputs: {},
      },
    ],
    { 'vpc@v1.0.0': leafDef },
    { 'root@v1.0.0': { nodes: { 'my-vpc': { position: { x: 42, y: 84 } } } } },
  );

  const updatedDef: ModuleDef = {
    ...leafDef,
    source: { kind: 'git', repo: 'new', ref: 'v1' },
  };

  const next = workspaceReducer(state, {
    type: 'REFRESH_MODULE_DEFS',
    updated_modules: { 'vpc@v1.0.0': updatedDef },
  });

  expect(next.layouts['root@v1.0.0'].nodes['my-vpc']).toEqual({
    position: { x: 42, y: 84 },
  });
});

test('REFRESH_MODULE_DEFS preserves wiring (out bindings) between instances', () => {
  const bucketDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'aws-s3-bucket',
    version: 'v1.0.0',
    interface: {
      inputs: [{ name: 'name', type: 'string', required: true }],
      outputs: [{ name: 'id', type: 'string' }],
    },
    source: { kind: 'git', repo: 'old', ref: 'v1' },
    graph: { instances: [], exports: { outputs: {} } },
  };
  const versioningDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'aws-s3-versioning',
    version: 'v1.0.0',
    interface: {
      inputs: [{ name: 'bucket_id', type: 'string', required: true }],
      outputs: [],
    },
    source: { kind: 'git', repo: 'old', ref: 'v1' },
    graph: { instances: [], exports: { outputs: {} } },
  };

  const state = makeWorkspace(
    [
      {
        kind: 'module',
        id: 'bucket',
        use: { module_id: 'aws-s3-bucket', version: 'v1.0.0' },
        inputs: { name: { lit: 'my-bucket' } },
      },
      {
        kind: 'module',
        id: 'versioning',
        use: { module_id: 'aws-s3-versioning', version: 'v1.0.0' },
        inputs: { bucket_id: { out: { module: 'bucket', name: 'id' } } },
      },
    ],
    {
      'aws-s3-bucket@v1.0.0': bucketDef,
      'aws-s3-versioning@v1.0.0': versioningDef,
    },
  );

  // Refresh both defs with updated source
  const next = workspaceReducer(state, {
    type: 'REFRESH_MODULE_DEFS',
    updated_modules: {
      'aws-s3-bucket@v1.0.0': {
        ...bucketDef,
        source: { kind: 'git', repo: 'new', ref: 'v1' },
      },
      'aws-s3-versioning@v1.0.0': {
        ...versioningDef,
        source: { kind: 'git', repo: 'new', ref: 'v1' },
      },
    },
  });

  // Wiring preserved
  const v = getInst(next, 'versioning');
  expect(v.inputs.bucket_id).toEqual({ out: { module: 'bucket', name: 'id' } });

  // Defs updated
  expect((next.modules['aws-s3-bucket@v1.0.0'].source as any).repo).toBe('new');
  expect((next.modules['aws-s3-versioning@v1.0.0'].source as any).repo).toBe('new');
});

test('REFRESH_MODULE_DEFS does not guard against entry overwrite (host responsibility)', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
  ]);
  // Deliberately overwrite the entry module — reducer does not block this
  const bogusRoot: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'root',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'bad', ref: 'v1' },
    graph: { instances: [], exports: { outputs: {} } },
  };
  const next = workspaceReducer(state, {
    type: 'REFRESH_MODULE_DEFS',
    updated_modules: { 'root@v1.0.0': bogusRoot },
  });
  // Reducer allows it — host must filter entry key before dispatching
  expect(next.modules['root@v1.0.0'].source).toBeDefined();
});

// ══════════════════════════════════════════════════════════════════════
// s3_stack validation scenario
// ══════════════════════════════════════════════════════════════════════

test('s3_stack scenario: variables, var bindings, curated outputs', () => {
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

// ══════════════════════════════════════════════════════════════════════
// CLEAR_GRAPH
// ══════════════════════════════════════════════════════════════════════

test('CLEAR_GRAPH clears instances and exports', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    { kind: 'module', id: 'b', use: { module_id: 'y', version: 'v1' }, inputs: {} },
  ]);
  // Set exports
  const def = state.modules['root@v1.0.0'];
  def.graph.exports.outputs['out1'] = { out: { module: 'a', name: 'arn' } };
  const next = workspaceReducer(state, {
    type: 'CLEAR_GRAPH',
    module_key: 'root@v1.0.0',
  });
  expect(getInstances(next, 'root@v1.0.0')).toHaveLength(0);
  expect(getExports(next, 'root@v1.0.0')).toEqual({});
});

test('CLEAR_GRAPH clears layout', () => {
  const state = makeWorkspace(
    [{ kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} }],
    {},
    { 'root@v1.0.0': { nodes: { a: { position: { x: 100, y: 200 } } } } },
  );
  const next = workspaceReducer(state, {
    type: 'CLEAR_GRAPH',
    module_key: 'root@v1.0.0',
  });
  expect(next.layouts['root@v1.0.0'].nodes).toEqual({});
});

test('CLEAR_GRAPH GCs orphaned module defs', () => {
  const leafDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'vpc',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    graph: { instances: [], exports: { outputs: {} } },
  };
  const state = makeWorkspace(
    [{ kind: 'module', id: 'my-vpc', use: { module_id: 'vpc', version: 'v1.0.0' }, inputs: {} }],
    { 'vpc@v1.0.0': leafDef },
  );
  expect(state.modules['vpc@v1.0.0']).toBeDefined();
  const next = workspaceReducer(state, {
    type: 'CLEAR_GRAPH',
    module_key: 'root@v1.0.0',
  });
  expect(next.modules['vpc@v1.0.0']).toBeUndefined();
  expect(next.modules['root@v1.0.0']).toBeDefined();
});

test('CLEAR_GRAPH preserves composite interface (variables/output defs)', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
  ]);
  // Set interface
  const withVars = workspaceReducer(state, {
    type: 'SET_VARIABLES',
    module_key: 'root@v1.0.0',
    variables: [{ name: 'region', type: 'string', required: true }],
  });
  const next = workspaceReducer(withVars, {
    type: 'CLEAR_GRAPH',
    module_key: 'root@v1.0.0',
  });
  expect(next.modules['root@v1.0.0'].interface.inputs).toEqual([
    { name: 'region', type: 'string', required: true },
  ]);
});

test('CLEAR_GRAPH on invalid module_key returns state unchanged', () => {
  const state = makeWorkspace([]);
  const next = workspaceReducer(state, {
    type: 'CLEAR_GRAPH',
    module_key: 'nonexistent@v1.0.0',
  });
  expect(next).toBe(state);
});

// ══════════════════════════════════════════════════════════════════════
// SET_TERRAFORM
// ══════════════════════════════════════════════════════════════════════

test('SET_TERRAFORM sets terraform block on module def', () => {
  const state = makeWorkspace([]);
  const terraform = {
    required_version: '>= 1.5.0',
    required_providers: {
      aws: { source: 'hashicorp/aws', version: '~> 5.0' },
    },
  };
  const next = workspaceReducer(state, {
    type: 'SET_TERRAFORM',
    module_key: 'root@v1.0.0',
    terraform,
  });
  expect(next.modules['root@v1.0.0'].terraform).toEqual(terraform);
});

test('SET_TERRAFORM replaces existing terraform block', () => {
  const state = makeWorkspace([]);
  const first = workspaceReducer(state, {
    type: 'SET_TERRAFORM',
    module_key: 'root@v1.0.0',
    terraform: { required_version: '>= 1.0.0' },
  });
  const second = workspaceReducer(first, {
    type: 'SET_TERRAFORM',
    module_key: 'root@v1.0.0',
    terraform: { required_version: '>= 1.5.0' },
  });
  expect(second.modules['root@v1.0.0'].terraform).toEqual({ required_version: '>= 1.5.0' });
});

test('SET_TERRAFORM on non-existent module_key returns state unchanged', () => {
  const state = makeWorkspace([]);
  const next = workspaceReducer(state, {
    type: 'SET_TERRAFORM',
    module_key: 'nonexistent@v1.0.0',
    terraform: { required_version: '>= 1.0.0' },
  });
  expect(next).toBe(state);
});

// ══════════════════════════════════════════════════════════════════════
// SET_PROVIDERS
// ══════════════════════════════════════════════════════════════════════

test('SET_PROVIDERS sets provider configurations on module def', () => {
  const state = makeWorkspace([]);
  const providers = [
    { name: 'aws', config: { region: 'us-east-1' } },
    { name: 'aws', alias: 'west', config: { region: 'us-west-2' } },
  ];
  const next = workspaceReducer(state, {
    type: 'SET_PROVIDERS',
    module_key: 'root@v1.0.0',
    providers,
  });
  expect(next.modules['root@v1.0.0'].providers).toEqual(providers);
});

test('SET_PROVIDERS on non-existent module_key returns state unchanged', () => {
  const state = makeWorkspace([]);
  const next = workspaceReducer(state, {
    type: 'SET_PROVIDERS',
    module_key: 'nonexistent@v1.0.0',
    providers: [],
  });
  expect(next).toBe(state);
});

// ══════════════════════════════════════════════════════════════════════
// SET_LOCALS
// ══════════════════════════════════════════════════════════════════════

test('SET_LOCALS sets locals on composite graph', () => {
  const state = makeWorkspace([]);
  const locals: import('../types/ir').LocalDef[] = [
    { name: 'prefix', value: { lit: 'prod' } },
    { name: 'tags', value: { expr: { lang: 'hcl', value: '{ env = "production" }' } } },
  ];
  const next = workspaceReducer(state, {
    type: 'SET_LOCALS',
    module_key: 'root@v1.0.0',
    locals,
  });
  const def = next.modules['root@v1.0.0'];
  expect(def.graph.locals).toEqual(locals);
});

test('SET_LOCALS with empty array sets locals to undefined', () => {
  const state = makeWorkspace([]);
  // First set some locals
  const withLocals = workspaceReducer(state, {
    type: 'SET_LOCALS',
    module_key: 'root@v1.0.0',
    locals: [{ name: 'x', value: { lit: '1' } }],
  });
  // Then clear them
  const next = workspaceReducer(withLocals, {
    type: 'SET_LOCALS',
    module_key: 'root@v1.0.0',
    locals: [],
  });
  const def = next.modules['root@v1.0.0'];
  expect(def.graph.locals).toBeUndefined();
});

// ══════════════════════════════════════════════════════════════════════
// SET_DEPENDS_ON
// ══════════════════════════════════════════════════════════════════════

test('SET_DEPENDS_ON sets depends_on on target instance', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    { kind: 'module', id: 'b', use: { module_id: 'y', version: 'v1' }, inputs: {} },
  ]);
  const next = workspaceReducer(state, {
    type: 'SET_DEPENDS_ON',
    module_key: 'root@v1.0.0',
    instance_id: 'b',
    depends_on: ['module.a'],
  });
  expect(getInst(next, 'b').depends_on).toEqual(['module.a']);
});

test('SET_DEPENDS_ON with empty array removes depends_on', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    {
      kind: 'module',
      id: 'b',
      use: { module_id: 'y', version: 'v1' },
      inputs: {},
      depends_on: ['module.a'],
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'SET_DEPENDS_ON',
    module_key: 'root@v1.0.0',
    instance_id: 'b',
    depends_on: [],
  });
  expect(getInst(next, 'b').depends_on).toBeUndefined();
});

// ══════════════════════════════════════════════════════════════════════
// SET_ENVIRONMENTS / SET_ENVIRONMENT_BACKENDS
// ══════════════════════════════════════════════════════════════════════

test('SET_ENVIRONMENTS sets environment map on workspace', () => {
  const state = makeWorkspace([]);
  const environments = {
    dev: { region: 'us-east-1' },
    prod: { region: 'us-west-2' },
  };
  const next = workspaceReducer(state, {
    type: 'SET_ENVIRONMENTS',
    environments,
  });
  expect(next.environments).toEqual(environments);
});

test('SET_ENVIRONMENT_BACKENDS sets backend configs on workspace', () => {
  const state = makeWorkspace([]);
  const backends = {
    dev: { type: 's3', config: { bucket: 'dev-state' } },
    prod: { type: 's3', config: { bucket: 'prod-state' } },
  };
  const next = workspaceReducer(state, {
    type: 'SET_ENVIRONMENT_BACKENDS',
    backends,
  });
  expect(next.environment_backends).toEqual(backends);
});

// ══════════════════════════════════════════════════════════════════════
// DROP_BUNDLE edge cases
// ══════════════════════════════════════════════════════════════════════

test('DROP_BUNDLE with leaf-like deploy entry (no instances) preserves existing graph', () => {
  const state = makeWorkspace([]);
  const deploy_bundle: import('../types/ir').ModuleBundle = {
    schema_version: '1.0',
    kind: 'module_bundle',
    entry: { module_id: 'leaf-only', version: 'v1.0.0' },
    modules: {
      'leaf-only@v1.0.0': {
        schema_version: '1.0',
        kind: 'module_def',
        id: 'leaf-only',
        version: 'v1.0.0',
        interface: { inputs: [], outputs: [] },
        source: { kind: 'registry' },
        graph: { instances: [], exports: { outputs: {} } },
      },
    },
  };
  const next = workspaceReducer(state, {
    type: 'DROP_BUNDLE',
    module_key: 'root@v1.0.0',
    deploy_bundle,
    positions: {},
  });
  // No new instances added — graph should still be empty
  const instances = getInstances(next, 'root@v1.0.0');
  expect(instances).toHaveLength(0);
});
