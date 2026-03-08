import { test, expect } from 'vitest';
import { workspaceReducer } from '../state/reducer';
import type { Module, Bundle } from '../types/ir';
import { loadFixture, makeWorkspace, getChild, getChildren, getExports } from './helpers';

// ══════════════════════════════════════════════════════════════════════
// CONNECT
// ══════════════════════════════════════════════════════════════════════

test('CONNECT sets out binding on target', () => {
  const state = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    { id: 'b', module: 'y@v1' },
  ]);
  const next = workspaceReducer(state, {
    type: 'CONNECT',
    module_key: 'root@v1.0.0',
    source_instance: 'a',
    target_instance: 'b',
    mapping: { from: 'arn', to: 'bucket' },
  });
  const b = getChild(next, 'b');
  expect(b.inputs!.bucket).toEqual({ out: { module: 'a', name: 'arn' } });
});

// ══════════════════════════════════════════════════════════════════════
// DISCONNECT
// ══════════════════════════════════════════════════════════════════════

test('DISCONNECT removes binding', () => {
  const state = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    {
      id: 'b',
      module: 'y@v1',
      inputs: { bucket: { out: { module: 'a', name: 'arn' } } },
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'DISCONNECT',
    module_key: 'root@v1.0.0',
    target_instance: 'b',
    input_name: 'bucket',
  });
  const b = getChild(next, 'b');
  expect(b.inputs?.bucket).toBeUndefined();
});

// ══════════════════════════════════════════════════════════════════════
// RENAME_INSTANCE
// ══════════════════════════════════════════════════════════════════════

test('RENAME_INSTANCE cascades to sibling out bindings', () => {
  const state = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    {
      id: 'b',
      module: 'y@v1',
      inputs: { bucket: { out: { module: 'a', name: 'arn' } } },
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'RENAME_INSTANCE',
    module_key: 'root@v1.0.0',
    old_id: 'a',
    new_id: 'vpc',
  });
  const b = getChild(next, 'b');
  expect(b.inputs!.bucket).toEqual({ out: { module: 'vpc', name: 'arn' } });
  // Original name gone
  expect(() => getChild(next, 'a')).toThrow();
  // New name exists
  expect(getChild(next, 'vpc')).toBeDefined();
});

test('RENAME_INSTANCE cascades to exports', () => {
  const state = makeWorkspace([{ id: 'a', module: 'x@v1' }]);
  // Manually set exports referencing 'a'
  const def = state.modules['root@v1.0.0'];
  def.exports.outputs['role_arn'] = {
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
    { id: 'a', module: 'x@v1' },
    {
      id: 'c',
      module: 'z@v1',
      depends_on: ['a'],
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'RENAME_INSTANCE',
    module_key: 'root@v1.0.0',
    old_id: 'a',
    new_id: 'vpc',
  });
  const c = getChild(next, 'c');
  expect(c.depends_on).toEqual(['vpc']);
});

test('RENAME_INSTANCE cascades to sibling depends_on with module. prefix', () => {
  const state = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    {
      id: 'c',
      module: 'z@v1',
      depends_on: ['module.a'],
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'RENAME_INSTANCE',
    module_key: 'root@v1.0.0',
    old_id: 'a',
    new_id: 'vpc',
  });
  const c = getChild(next, 'c');
  expect(c.depends_on).toEqual(['module.vpc']);
});

test('RENAME_INSTANCE cascades to layout key', () => {
  const state = makeWorkspace(
    [{ id: 'a', module: 'x@v1' }],
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
    [{ id: 'a', module: 'x@v1' }],
    {},
    { 'root@v1.0.0': { nodes: { a: { position: { x: 100, y: 200 } } } } },
  );
  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'a',
  });
  expect(getChildren(next, 'root@v1.0.0')).toHaveLength(0);
  expect(next.layouts['root@v1.0.0'].nodes['a']).toBeUndefined();
});

test('DELETE_INSTANCE cleans up sibling out bindings referencing deleted instance', () => {
  const state = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    {
      id: 'b',
      module: 'y@v1',
      inputs: { bucket: { out: { module: 'a', name: 'arn' } } },
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'a',
  });
  const b = getChild(next, 'b');
  expect(b.inputs?.bucket).toBeUndefined();
});

test('DELETE_INSTANCE cleans up exports referencing deleted instance', () => {
  const state = makeWorkspace([{ id: 'a', module: 'x@v1' }]);
  const def = state.modules['root@v1.0.0'];
  def.exports.outputs['role_arn'] = {
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
    { id: 'a', module: 'x@v1' },
    {
      id: 'c',
      module: 'z@v1',
      depends_on: ['a'],
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'a',
  });
  const c = getChild(next, 'c');
  // depends_on should be removed (empty array removed)
  expect(c.depends_on).toBeUndefined();
});

test('DELETE_INSTANCE cleans up sibling depends_on with module. prefix', () => {
  const state = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    {
      id: 'c',
      module: 'z@v1',
      depends_on: ['module.a', 'module.b'],
    },
    { id: 'b', module: 'y@v1' },
  ]);
  const next = workspaceReducer(state, {
    type: 'DELETE_INSTANCE',
    module_key: 'root@v1.0.0',
    instance_id: 'a',
  });
  const c = getChild(next, 'c');
  // module.a removed, module.b preserved
  expect(c.depends_on).toEqual(['module.b']);
});

test('DELETE_INSTANCE removes orphaned module defs from state.modules', () => {
  const leafDef: Module = {
    id: 'rds-instance',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    exports: { outputs: {} },
  };
  const state = makeWorkspace(
    [
      {
        id: 'my-rds',
        module: 'rds-instance@v1.0.0',
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
  expect(getChildren(next, 'root@v1.0.0')).toHaveLength(0);
  // Orphaned module def cleaned up
  expect(next.modules['rds-instance@v1.0.0']).toBeUndefined();
  // Root composite preserved
  expect(next.modules['root@v1.0.0']).toBeDefined();
});

test('DELETE_INSTANCE preserves module defs still referenced by other instances', () => {
  const leafDef: Module = {
    id: 'vpc',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    exports: { outputs: {} },
  };
  const state = makeWorkspace(
    [
      {
        id: 'vpc-1',
        module: 'vpc@v1.0.0',
      },
      {
        id: 'vpc-2',
        module: 'vpc@v1.0.0',
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
  expect(getChildren(next, 'root@v1.0.0')).toHaveLength(1);
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
  // Verify: leaf Module merged into modules
  expect(next.modules['aws-s3-bucket@v1.2.0']).toBeDefined();
  // Verify: instance inlined
  const children = getChildren(next, 'root@v1.0.0');
  expect(children.find((i) => i.id === 'aws-s3-bucket')).toBeDefined();
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
      id: 'aws-s3-bucket',
      module: 'aws-s3-bucket@v1.2.0',
    },
  ]);
  const deploy_bundle = loadFixture('leaf_deploy_bundle.json');
  const next = workspaceReducer(state, {
    type: 'DROP_BUNDLE',
    module_key: 'root@v1.0.0',
    deploy_bundle,
    positions: {},
  });
  const children = getChildren(next, 'root@v1.0.0');
  // Original should still exist
  expect(children.find((i) => i.id === 'aws-s3-bucket')).toBeDefined();
  // New one should have _1 suffix
  expect(children.find((i) => i.id === 'aws-s3-bucket_1')).toBeDefined();
});

test('DROP_BUNDLE preserves existing node layout positions', () => {
  const state = makeWorkspace(
    [
      {
        id: 'existing-node',
        module: 'aws-s3-bucket@v1.2.0',
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
  const newId = getChildren(next, 'root@v1.0.0').find((i) => i.id !== 'existing-node')!.id;
  expect(next.layouts['root@v1.0.0'].nodes[newId]).toBeDefined();
});

// ══════════════════════════════════════════════════════════════════════
// LOAD_WORKSPACE
// ══════════════════════════════════════════════════════════════════════

test('LOAD_WORKSPACE replaces entire state', () => {
  const state = makeWorkspace([]);
  const newState = makeWorkspace([{ id: 'x', module: 'a@v1' }]);
  const next = workspaceReducer(state, { type: 'LOAD_WORKSPACE', workspace: newState });
  // No orphans → GC returns same reference
  expect(next).toBe(newState);
});

test('LOAD_WORKSPACE removes orphaned module defs not referenced by any instance', () => {
  const referencedDef: Module = {
    id: 'vpc',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    exports: { outputs: {} },
  };
  const orphanDef: Module = {
    id: 'rds-instance',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    exports: { outputs: {} },
  };
  // Simulate loading a lace.json that has orphaned defs from earlier bugs
  const dirtyState = makeWorkspace([{ id: 'my-vpc', module: 'vpc@v1.0.0' }], {
    'vpc@v1.0.0': referencedDef,
    'rds-instance@v1.0.0': orphanDef,
  });

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
      id: 'a',
      module: 'x@v1',
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
  const a = getChild(next, 'a');
  expect(a.inputs).toEqual(newInputs);
  expect(a.inputs!.old).toBeUndefined();
});

// ══════════════════════════════════════════════════════════════════════
// SYNC_LAYOUT
// ══════════════════════════════════════════════════════════════════════

test('SYNC_LAYOUT merges with existing positions (does not clobber siblings)', () => {
  const state = makeWorkspace(
    [
      { id: 'a', module: 'x@v1' },
      { id: 'b', module: 'y@v1' },
      { id: 'c', module: 'z@v1' },
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
    [{ id: 'a', module: 'x@v1' }],
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

test('SET_EXPORTS sets both interface.outputs and exports.outputs', () => {
  const state = makeWorkspace([
    {
      id: 's3_bucket',
      module: 'aws-s3-bucket@v1.2.0',
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
  // exports.outputs updated
  const def = next.modules['root@v1.0.0'];
  expect(def.exports.outputs).toEqual(outputs);
});

test('SET_EXPORTS replaces existing exports', () => {
  const state = makeWorkspace([{ id: 'a', module: 'x@v1' }]);
  // Set initial exports
  const first = workspaceReducer(state, {
    type: 'SET_EXPORTS',
    module_key: 'root@v1.0.0',
    outputs: { old_out: { out: { module: 'a', name: 'arn' } } },
    output_defs: [{ name: 'old_out', type: 'string' }],
  });
  const firstDef = first.modules['root@v1.0.0'];
  expect(firstDef.exports.outputs['old_out']).toBeDefined();

  // Replace
  const second = workspaceReducer(first, {
    type: 'SET_EXPORTS',
    module_key: 'root@v1.0.0',
    outputs: { new_out: { out: { module: 'a', name: 'id' } } },
    output_defs: [{ name: 'new_out', type: 'string' }],
  });
  const secondDef = second.modules['root@v1.0.0'];
  expect(secondDef.exports.outputs['old_out']).toBeUndefined();
  expect(secondDef.exports.outputs['new_out']).toEqual({
    out: { module: 'a', name: 'id' },
  });
  expect(second.modules['root@v1.0.0'].interface.outputs).toEqual([
    { name: 'new_out', type: 'string' },
  ]);
});

test('SET_EXPORTS on non-composite module_key returns state unchanged', () => {
  const state = makeWorkspace([]);
  // Add a leaf module
  const leafDef: Module = {
    id: 'leaf',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    exports: { outputs: {} },
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
  // interface.outputs updated; leaf modules have no child modules to affect
  expect(next.modules['leaf@v1.0.0'].interface.outputs).toEqual([{ name: 'x', type: 'string' }]);
});

// ══════════════════════════════════════════════════════════════════════
// REFRESH_MODULE_DEFS
// ══════════════════════════════════════════════════════════════════════

test('REFRESH_MODULE_DEFS merges updated defs, preserves instance inputs and root composite', () => {
  const leafDef: Module = {
    id: 'aws-s3-bucket',
    version: 'v1.2.0',
    interface: {
      inputs: [{ name: 'bucket_name', type: 'string', required: true }],
      outputs: [{ name: 'arn', type: 'string' }],
    },
    source: { kind: 'git', repo: 'old-repo', ref: 'v1.2.0' },
    exports: { outputs: {} },
  };
  const state = makeWorkspace(
    [
      {
        id: 's3',
        module: 'aws-s3-bucket@v1.2.0',
        inputs: { bucket_name: { lit: 'my-bucket' } },
      },
    ],
    { 'aws-s3-bucket@v1.2.0': leafDef },
  );

  // Updated def: fixed git URL
  const updatedDef: Module = {
    ...leafDef,
    interface: {
      inputs: [
        { name: 'bucket_name', type: 'string', required: true },
        { name: 'tags', type: 'map(string)', required: false },
      ],
      outputs: [{ name: 'arn', type: 'string' }],
    },
    source: { kind: 'git', repo: 'fixed-repo', ref: 'v1.2.0' },
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

  // Instance inputs preserved
  const s3 = getChild(next, 's3');
  expect(s3.inputs!.bucket_name).toEqual({ lit: 'my-bucket' });
});

test('REFRESH_MODULE_DEFS with empty map returns same state reference', () => {
  const state = makeWorkspace([{ id: 'a', module: 'x@v1' }]);
  const next = workspaceReducer(state, {
    type: 'REFRESH_MODULE_DEFS',
    updated_modules: {},
  });
  expect(next).toBe(state); // reference equality — no re-render
});

test('REFRESH_MODULE_DEFS preserves layouts', () => {
  const leafDef: Module = {
    id: 'vpc',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'old', ref: 'v1' },
    exports: { outputs: {} },
  };
  const state = makeWorkspace(
    [
      {
        id: 'my-vpc',
        module: 'vpc@v1.0.0',
      },
    ],
    { 'vpc@v1.0.0': leafDef },
    { 'root@v1.0.0': { nodes: { 'my-vpc': { position: { x: 42, y: 84 } } } } },
  );

  const updatedDef: Module = {
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
  const bucketDef: Module = {
    id: 'aws-s3-bucket',
    version: 'v1.0.0',
    interface: {
      inputs: [{ name: 'name', type: 'string', required: true }],
      outputs: [{ name: 'id', type: 'string' }],
    },
    source: { kind: 'git', repo: 'old', ref: 'v1' },
    exports: { outputs: {} },
  };
  const versioningDef: Module = {
    id: 'aws-s3-versioning',
    version: 'v1.0.0',
    interface: {
      inputs: [{ name: 'bucket_id', type: 'string', required: true }],
      outputs: [],
    },
    source: { kind: 'git', repo: 'old', ref: 'v1' },
    exports: { outputs: {} },
  };

  const state = makeWorkspace(
    [
      {
        id: 'bucket',
        module: 'aws-s3-bucket@v1.0.0',
        inputs: { name: { lit: 'my-bucket' } },
      },
      {
        id: 'versioning',
        module: 'aws-s3-versioning@v1.0.0',
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
  const v = getChild(next, 'versioning');
  expect(v.inputs!.bucket_id).toEqual({ out: { module: 'bucket', name: 'id' } });

  // Defs updated
  expect((next.modules['aws-s3-bucket@v1.0.0'].source as any).repo).toBe('new');
  expect((next.modules['aws-s3-versioning@v1.0.0'].source as any).repo).toBe('new');
});

test('REFRESH_MODULE_DEFS does not guard against entry overwrite (host responsibility)', () => {
  const state = makeWorkspace([{ id: 'a', module: 'x@v1' }]);
  // Deliberately overwrite the entry module — reducer does not block this
  const bogusRoot: Module = {
    id: 'root',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'bad', ref: 'v1' },
    exports: { outputs: {} },
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
  const children = getChildren(state, 'root@v1.0.0');
  expect(children.find((i) => i.id === 's3_bucket')).toBeDefined();
  expect(children.find((i) => i.id === 's3_bucket_versioning')).toBeDefined();

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
  const s3Bucket = getChild(state, 's3_bucket');
  expect(s3Bucket.inputs!.bucket_name).toEqual({ var: 'bucket_name' });
  expect(s3Bucket.inputs!.tags).toEqual({ var: 'tags' });

  // 5. Verify the wire from CONNECT is preserved (s3_bucket.id → s3_bucket_versioning.bucket_id)
  const versioning = getChild(state, 's3_bucket_versioning');
  expect(versioning.inputs!.bucket_id).toEqual({ out: { module: 's3_bucket', name: 'id' } });

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

  // Verify exports.outputs
  const exports = getExports(state, 'root@v1.0.0');
  expect(exports['bucket_arn']).toEqual({ out: { module: 's3_bucket', name: 'arn' } });
  expect(exports['bucket_id']).toEqual({ out: { module: 's3_bucket', name: 'id' } });
});

// ══════════════════════════════════════════════════════════════════════
// CLEAR_GRAPH
// ══════════════════════════════════════════════════════════════════════

test('CLEAR_GRAPH clears instances and exports', () => {
  const state = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    { id: 'b', module: 'y@v1' },
  ]);
  // Set exports
  const def = state.modules['root@v1.0.0'];
  def.exports.outputs['out1'] = { out: { module: 'a', name: 'arn' } };
  const next = workspaceReducer(state, {
    type: 'CLEAR_GRAPH',
    module_key: 'root@v1.0.0',
  });
  expect(getChildren(next, 'root@v1.0.0')).toHaveLength(0);
  expect(getExports(next, 'root@v1.0.0')).toEqual({});
});

test('CLEAR_GRAPH clears layout', () => {
  const state = makeWorkspace(
    [{ id: 'a', module: 'x@v1' }],
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
  const leafDef: Module = {
    id: 'vpc',
    version: 'v1.0.0',
    interface: { inputs: [], outputs: [] },
    source: { kind: 'git', repo: 'test', ref: 'v1' },
    exports: { outputs: {} },
  };
  const state = makeWorkspace([{ id: 'my-vpc', module: 'vpc@v1.0.0' }], { 'vpc@v1.0.0': leafDef });
  expect(state.modules['vpc@v1.0.0']).toBeDefined();
  const next = workspaceReducer(state, {
    type: 'CLEAR_GRAPH',
    module_key: 'root@v1.0.0',
  });
  expect(next.modules['vpc@v1.0.0']).toBeUndefined();
  expect(next.modules['root@v1.0.0']).toBeDefined();
});

test('CLEAR_GRAPH preserves composite interface (variables/output defs)', () => {
  const state = makeWorkspace([{ id: 'a', module: 'x@v1' }]);
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

test('SET_LOCALS sets locals on composite module', () => {
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
  expect(def.locals).toEqual(locals);
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
  expect(def.locals).toBeUndefined();
});

// ══════════════════════════════════════════════════════════════════════
// SET_DEPENDS_ON
// ══════════════════════════════════════════════════════════════════════

test('SET_DEPENDS_ON sets depends_on on target instance', () => {
  const state = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    { id: 'b', module: 'y@v1' },
  ]);
  const next = workspaceReducer(state, {
    type: 'SET_DEPENDS_ON',
    module_key: 'root@v1.0.0',
    instance_id: 'b',
    depends_on: ['module.a'],
  });
  expect(getChild(next, 'b').depends_on).toEqual(['module.a']);
});

test('SET_DEPENDS_ON with empty array removes depends_on', () => {
  const state = makeWorkspace([
    { id: 'a', module: 'x@v1' },
    {
      id: 'b',
      module: 'y@v1',
      depends_on: ['module.a'],
    },
  ]);
  const next = workspaceReducer(state, {
    type: 'SET_DEPENDS_ON',
    module_key: 'root@v1.0.0',
    instance_id: 'b',
    depends_on: [],
  });
  expect(getChild(next, 'b').depends_on).toBeUndefined();
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
  const deploy_bundle: Bundle = {
    schema_version: '1.0',
    kind: 'bundle',
    entry: 'leaf-only@v1.0.0',
    modules: {
      'leaf-only@v1.0.0': {
        id: 'leaf-only',
        version: 'v1.0.0',
        interface: { inputs: [], outputs: [] },
        source: { kind: 'registry' },
        exports: { outputs: {} },
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
  const children = getChildren(next, 'root@v1.0.0');
  expect(children).toHaveLength(0);
});
