import { test, expect } from 'vitest';
import { workspaceReducer } from '../state/reducer';
import type { WorkspaceState } from '../types/workspace';
import type { Instance, ModuleDef, OutputExport } from '../types/ir';
import { toBundle, fromBundle } from '../utils/bundle';

// ══════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════

function makeWorkspace(
  instances: Instance[],
  modules: Record<string, ModuleDef> = {},
  layouts: Record<string, any> = {},
  exports: Record<string, OutputExport> = {},
  variables: ModuleDef['interface']['inputs'] = [],
): WorkspaceState {
  const moduleKey = 'root@v1.0.0';
  const rootDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'root',
    version: 'v1.0.0',
    interface: { inputs: variables, outputs: [] },
    impl: {
      kind: 'composite',
      graph: {
        instances,
        exports: { outputs: exports },
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

function getInstances(state: WorkspaceState, key: string): Instance[] {
  const def = state.modules[key];
  if (def.impl.kind !== 'composite') throw new Error('Not composite');
  return def.impl.graph.instances;
}

function getExports(state: WorkspaceState, key: string): Record<string, OutputExport> {
  const def = state.modules[key];
  if (def.impl.kind !== 'composite') throw new Error('Not composite');
  return def.impl.graph.exports.outputs;
}

function getInst(state: WorkspaceState, key: string, id: string): Instance {
  const instances = getInstances(state, key);
  const inst = instances.find((i) => i.id === id);
  if (!inst) throw new Error(`Instance ${id} not found in ${key}`);
  return inst;
}

// Leaf module defs for test fixtures
const leafA: ModuleDef = {
  schema_version: '1.0',
  kind: 'module_def',
  id: 'mod_a',
  version: 'v1.0.0',
  interface: {
    inputs: [{ name: 'name', type: 'string', required: true }],
    outputs: [
      { name: 'arn', type: 'string' },
      { name: 'id', type: 'string' },
    ],
  },
  impl: { kind: 'leaf', source: { kind: 'git', repo: 'test', ref: 'v1' } },
};

const leafB: ModuleDef = {
  schema_version: '1.0',
  kind: 'module_def',
  id: 'mod_b',
  version: 'v1.0.0',
  interface: {
    inputs: [{ name: 'target_arn', type: 'string', required: true }],
    outputs: [{ name: 'result', type: 'string' }],
  },
  impl: { kind: 'leaf', source: { kind: 'git', repo: 'test', ref: 'v1' } },
};

const leafC: ModuleDef = {
  schema_version: '1.0',
  kind: 'module_def',
  id: 'mod_c',
  version: 'v1.0.0',
  interface: {
    inputs: [
      { name: 'role_name', type: 'string', required: true },
      { name: 'policy_arn', type: 'string', required: true },
    ],
    outputs: [],
  },
  impl: { kind: 'leaf', source: { kind: 'git', repo: 'test', ref: 'v1' } },
};

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: simple case — 2 instances grouped
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: simple case — 2 instances grouped', () => {
  // Setup: 3 instances A, B, C. B→C wired (B.result → C.role_name).
  const state = makeWorkspace(
    [
      { kind: 'module', id: 'a', use: { module_id: 'mod_a', version: 'v1.0.0' }, inputs: {} },
      { kind: 'module', id: 'b', use: { module_id: 'mod_b', version: 'v1.0.0' }, inputs: {} },
      {
        kind: 'module',
        id: 'c',
        use: { module_id: 'mod_c', version: 'v1.0.0' },
        inputs: { role_name: { out: { module: 'b', name: 'result' } } },
      },
    ],
    { 'mod_a@v1.0.0': leafA, 'mod_b@v1.0.0': leafB, 'mod_c@v1.0.0': leafC },
  );

  // Action: group [b, c] into sub_composite
  const next = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'root@v1.0.0',
    instance_ids: ['b', 'c'],
    composite_id: 'sub_composite',
  });

  // Verify: parent has [a, sub_composite]
  const parentInstances = getInstances(next, 'root@v1.0.0');
  expect(parentInstances).toHaveLength(2);
  expect(parentInstances.find((i) => i.id === 'a')).toBeDefined();
  expect(parentInstances.find((i) => i.id === 'sub_composite')).toBeDefined();

  // Verify: sub has [b, c] with wiring intact
  const subInstances = getInstances(next, 'sub_composite@v1.0.0');
  expect(subInstances).toHaveLength(2);
  expect(subInstances.find((i) => i.id === 'b')).toBeDefined();
  expect(subInstances.find((i) => i.id === 'c')).toBeDefined();

  // Internal wiring preserved: c.role_name still references b.result
  const cInst = getInst(next, 'sub_composite@v1.0.0', 'c');
  expect(cInst.inputs.role_name).toEqual({ out: { module: 'b', name: 'result' } });

  // Sub-composite is in modules as a composite
  const subDef = next.modules['sub_composite@v1.0.0'];
  expect(subDef).toBeDefined();
  expect(subDef.impl.kind).toBe('composite');
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: external dependencies become var bindings
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: external dependencies become var bindings', () => {
  // Setup: A→B (a.arn → b.target_arn), B→C (b.result → c.role_name). Group [B, C].
  const state = makeWorkspace(
    [
      { kind: 'module', id: 'a', use: { module_id: 'mod_a', version: 'v1.0.0' }, inputs: {} },
      {
        kind: 'module',
        id: 'b',
        use: { module_id: 'mod_b', version: 'v1.0.0' },
        inputs: { target_arn: { out: { module: 'a', name: 'arn' } } },
      },
      {
        kind: 'module',
        id: 'c',
        use: { module_id: 'mod_c', version: 'v1.0.0' },
        inputs: { role_name: { out: { module: 'b', name: 'result' } } },
      },
    ],
    { 'mod_a@v1.0.0': leafA, 'mod_b@v1.0.0': leafB, 'mod_c@v1.0.0': leafC },
  );

  const next = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'root@v1.0.0',
    instance_ids: ['b', 'c'],
    composite_id: 'sub_composite',
  });

  // Verify: sub_composite has a variable for A's output
  const subDef = next.modules['sub_composite@v1.0.0'];
  expect(subDef.interface.inputs.find((i) => i.name === 'a_arn')).toBeDefined();

  // B's input is now a var binding inside sub-composite
  const bInst = getInst(next, 'sub_composite@v1.0.0', 'b');
  expect(bInst.inputs.target_arn).toEqual({ var: 'a_arn' });

  // Parent wires a.arn → sub_composite.a_arn
  const subInst = getInst(next, 'root@v1.0.0', 'sub_composite');
  expect(subInst.inputs.a_arn).toEqual({ out: { module: 'a', name: 'arn' } });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: exports crossing boundary
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: exports crossing boundary', () => {
  // Setup: A, B, C. Root exports B.result and C via b_result.
  const state = makeWorkspace(
    [
      { kind: 'module', id: 'a', use: { module_id: 'mod_a', version: 'v1.0.0' }, inputs: {} },
      { kind: 'module', id: 'b', use: { module_id: 'mod_b', version: 'v1.0.0' }, inputs: {} },
      { kind: 'module', id: 'c', use: { module_id: 'mod_c', version: 'v1.0.0' }, inputs: {} },
    ],
    { 'mod_a@v1.0.0': leafA, 'mod_b@v1.0.0': leafB, 'mod_c@v1.0.0': leafC },
    {},
    { b_result: { out: { module: 'b', name: 'result' } } },
  );

  // Group [B, C]
  const next = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'root@v1.0.0',
    instance_ids: ['b', 'c'],
    composite_id: 'sub_composite',
  });

  // Sub-composite exports B.result
  const subExports = getExports(next, 'sub_composite@v1.0.0');
  expect(subExports['b_result']).toEqual({ out: { module: 'b', name: 'result' } });

  // Root's export now references sub_composite
  const rootExports = getExports(next, 'root@v1.0.0');
  expect(rootExports['b_result']).toEqual({ out: { module: 'sub_composite', name: 'b_result' } });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: boundary-out rewiring
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: boundary-out references are rewired to composite outputs', () => {
  // Setup: A→B (a.arn → b.target_arn). Group [A] alone.
  // After: remaining [B] should reference sub_composite's output for A.arn
  const state = makeWorkspace(
    [
      { kind: 'module', id: 'a', use: { module_id: 'mod_a', version: 'v1.0.0' }, inputs: {} },
      {
        kind: 'module',
        id: 'b',
        use: { module_id: 'mod_b', version: 'v1.0.0' },
        inputs: { target_arn: { out: { module: 'a', name: 'arn' } } },
      },
    ],
    { 'mod_a@v1.0.0': leafA, 'mod_b@v1.0.0': leafB },
  );

  const next = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'root@v1.0.0',
    instance_ids: ['a'],
    composite_id: 'sub_a',
  });

  // Parent: B's target_arn now references sub_a's export
  const bInst = getInst(next, 'root@v1.0.0', 'b');
  expect(bInst.inputs.target_arn).toEqual({ out: { module: 'sub_a', name: 'a_arn' } });

  // Sub-composite exports a.arn
  const subExports = getExports(next, 'sub_a@v1.0.0');
  expect(subExports['a_arn']).toEqual({ out: { module: 'a', name: 'arn' } });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: layout entries migrate correctly
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: layout entries migrate correctly', () => {
  const state = makeWorkspace(
    [
      { kind: 'module', id: 'a', use: { module_id: 'mod_a', version: 'v1.0.0' }, inputs: {} },
      { kind: 'module', id: 'b', use: { module_id: 'mod_b', version: 'v1.0.0' }, inputs: {} },
      { kind: 'module', id: 'c', use: { module_id: 'mod_c', version: 'v1.0.0' }, inputs: {} },
    ],
    { 'mod_a@v1.0.0': leafA, 'mod_b@v1.0.0': leafB, 'mod_c@v1.0.0': leafC },
    {
      'root@v1.0.0': {
        nodes: {
          a: { position: { x: 0, y: 0 } },
          b: { position: { x: 200, y: 0 } },
          c: { position: { x: 200, y: 200 } },
        },
      },
    },
  );

  const next = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'root@v1.0.0',
    instance_ids: ['b', 'c'],
    composite_id: 'sub_composite',
  });

  // Parent layout: loses b and c, gains sub_composite at center of removed positions
  const parentLayout = next.layouts['root@v1.0.0'];
  expect(parentLayout.nodes['b']).toBeUndefined();
  expect(parentLayout.nodes['c']).toBeUndefined();
  expect(parentLayout.nodes['a']).toBeDefined();
  expect(parentLayout.nodes['sub_composite']).toBeDefined();
  expect(parentLayout.nodes['sub_composite'].position).toEqual({ x: 200, y: 100 }); // center of (200,0) and (200,200)

  // Sub layout has the original positions of b and c
  const subLayout = next.layouts['sub_composite@v1.0.0'];
  expect(subLayout.nodes['b']).toEqual({ position: { x: 200, y: 0 } });
  expect(subLayout.nodes['c']).toEqual({ position: { x: 200, y: 200 } });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: var bindings propagate into sub-composite
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: var bindings propagate into sub-composite', () => {
  const state = makeWorkspace(
    [
      {
        kind: 'module',
        id: 'a',
        use: { module_id: 'mod_a', version: 'v1.0.0' },
        inputs: { name: { var: 'role_name' } },
      },
      { kind: 'module', id: 'b', use: { module_id: 'mod_b', version: 'v1.0.0' }, inputs: {} },
    ],
    { 'mod_a@v1.0.0': leafA, 'mod_b@v1.0.0': leafB },
    {},
    {},
    [{ name: 'role_name', type: 'string', required: true, description: 'IAM role name' }],
  );

  const next = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'root@v1.0.0',
    instance_ids: ['a'],
    composite_id: 'sub_a',
  });

  // Sub-composite has role_name as an input variable
  const subDef = next.modules['sub_a@v1.0.0'];
  const roleNameInput = subDef.interface.inputs.find((i) => i.name === 'role_name');
  expect(roleNameInput).toBeDefined();
  expect(roleNameInput!.type).toBe('string');
  expect(roleNameInput!.required).toBe(true);
  expect(roleNameInput!.description).toBe('IAM role name');

  // Inside sub-composite, instance still has var binding
  const aInst = getInst(next, 'sub_a@v1.0.0', 'a');
  expect(aInst.inputs.name).toEqual({ var: 'role_name' });

  // Parent's composite instance passes through the var
  const subInst = getInst(next, 'root@v1.0.0', 'sub_a');
  expect(subInst.inputs.role_name).toEqual({ var: 'role_name' });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: depends_on rewriting
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: depends_on entries are rewritten correctly', () => {
  const state = makeWorkspace(
    [
      { kind: 'module', id: 'a', use: { module_id: 'mod_a', version: 'v1.0.0' }, inputs: {} },
      {
        kind: 'module',
        id: 'b',
        use: { module_id: 'mod_b', version: 'v1.0.0' },
        inputs: {},
        depends_on: ['a'],
      },
      {
        kind: 'module',
        id: 'c',
        use: { module_id: 'mod_c', version: 'v1.0.0' },
        inputs: {},
        depends_on: ['b'],
      },
    ],
    { 'mod_a@v1.0.0': leafA, 'mod_b@v1.0.0': leafB, 'mod_c@v1.0.0': leafC },
  );

  // Group [a, b] — b depends on a (internal), c depends on b (boundary)
  const next = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'root@v1.0.0',
    instance_ids: ['a', 'b'],
    composite_id: 'sub_ab',
  });

  // Internal depends_on preserved in sub-composite
  const bInst = getInst(next, 'sub_ab@v1.0.0', 'b');
  expect(bInst.depends_on).toEqual(['a']);

  // External depends_on rewritten to reference composite instance
  const cInst = getInst(next, 'root@v1.0.0', 'c');
  expect(cInst.depends_on).toEqual(['sub_ab']);
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: empty selection returns state unchanged
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: empty selection returns state unchanged', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'mod_a', version: 'v1.0.0' }, inputs: {} },
  ]);
  const next = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'root@v1.0.0',
    instance_ids: [],
    composite_id: 'sub',
  });
  expect(next).toBe(state);
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: determinism — same selection produces same result
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: determinism — same input produces same output', () => {
  const state = makeWorkspace(
    [
      { kind: 'module', id: 'a', use: { module_id: 'mod_a', version: 'v1.0.0' }, inputs: {} },
      {
        kind: 'module',
        id: 'b',
        use: { module_id: 'mod_b', version: 'v1.0.0' },
        inputs: { target_arn: { out: { module: 'a', name: 'arn' } } },
      },
    ],
    { 'mod_a@v1.0.0': leafA, 'mod_b@v1.0.0': leafB },
  );

  const action = {
    type: 'GROUP_INTO_COMPOSITE' as const,
    module_key: 'root@v1.0.0',
    instance_ids: ['a', 'b'],
    composite_id: 'sub',
  };

  const result1 = workspaceReducer(state, action);
  const result2 = workspaceReducer(state, action);
  expect(result1).toEqual(result2);
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: round-trip through toBundle
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: round-trip through toBundle matches expected', () => {
  const state = makeWorkspace(
    [
      { kind: 'module', id: 'a', use: { module_id: 'mod_a', version: 'v1.0.0' }, inputs: {} },
      {
        kind: 'module',
        id: 'b',
        use: { module_id: 'mod_b', version: 'v1.0.0' },
        inputs: { target_arn: { out: { module: 'a', name: 'arn' } } },
      },
      {
        kind: 'module',
        id: 'c',
        use: { module_id: 'mod_c', version: 'v1.0.0' },
        inputs: {
          role_name: { out: { module: 'b', name: 'result' } },
          policy_arn: { out: { module: 'a', name: 'arn' } },
        },
      },
    ],
    { 'mod_a@v1.0.0': leafA, 'mod_b@v1.0.0': leafB, 'mod_c@v1.0.0': leafC },
  );

  // Group [b, c]
  const grouped = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'root@v1.0.0',
    instance_ids: ['b', 'c'],
    composite_id: 'sub_bc',
  });

  // toBundle generates wires
  const bundle = toBundle(grouped);

  // Verify sub-composite exists in the bundle
  expect(bundle.modules['sub_bc@v1.0.0']).toBeDefined();
  expect(bundle.modules['sub_bc@v1.0.0'].impl.kind).toBe('composite');

  // Verify sub-composite has wires
  const subGraph = bundle.modules['sub_bc@v1.0.0'].impl;
  if (subGraph.kind === 'composite') {
    expect(subGraph.graph.wires).toBeDefined();
    expect(subGraph.graph.wires!.length).toBeGreaterThan(0);
  }

  // Round-trip: fromBundle → toBundle should be stable
  const { workspace: parsed } = fromBundle(bundle);
  const rebundled = toBundle(parsed);

  // Module keys preserved
  expect(Object.keys(rebundled.modules).sort()).toEqual(Object.keys(bundle.modules).sort());

  // Sub-composite structure preserved
  const subDef = rebundled.modules['sub_bc@v1.0.0'];
  expect(subDef.interface.inputs.length).toBeGreaterThan(0);
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: iam_stack validation scenario
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: iam_stack scenario — group policy + attachment into sub-composite', () => {
  // Recreate iam_stack: iam_role, iam_policy, iam_policy_attachment
  const iamRoleDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'aws-iam-role',
    version: 'v2.0.0',
    interface: {
      inputs: [
        { name: 'role_name', type: 'string', required: true },
        { name: 'assume_role_policy', type: 'string', required: true },
        { name: 'max_session_duration', type: 'number', required: false },
        { name: 'tags', type: 'map(string)', required: false },
      ],
      outputs: [
        { name: 'arn', type: 'string' },
        { name: 'role_name', type: 'string' },
        { name: 'unique_id', type: 'string' },
      ],
    },
    impl: { kind: 'leaf', source: { kind: 'git', repo: 'test', ref: 'v2.0.0' } },
  };

  const iamPolicyDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'aws-iam-policy',
    version: 'v1.0.0',
    interface: {
      inputs: [
        { name: 'policy_name', type: 'string', required: true },
        { name: 'policy_document', type: 'string', required: true },
        { name: 'tags', type: 'map(string)', required: false },
      ],
      outputs: [
        { name: 'arn', type: 'string' },
        { name: 'policy_name', type: 'string' },
      ],
    },
    impl: { kind: 'leaf', source: { kind: 'git', repo: 'test', ref: 'v1.0.0' } },
  };

  const iamAttachDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'aws-iam-role-policy-attachment',
    version: 'v1.0.0',
    interface: {
      inputs: [
        { name: 'role_name', type: 'string', required: true },
        { name: 'policy_arn', type: 'string', required: true },
      ],
      outputs: [],
    },
    impl: { kind: 'leaf', source: { kind: 'git', repo: 'test', ref: 'v1.0.0' } },
  };

  // Start with 3 instances wired like the IAM stack
  let state = makeWorkspace(
    [
      {
        kind: 'module',
        id: 'iam_role',
        use: { module_id: 'aws-iam-role', version: 'v2.0.0' },
        inputs: {
          role_name: { var: 'role_name' },
          assume_role_policy: {
            expr: { lang: 'hcl', value: 'jsonencode({Version = "2012-10-17"})' },
          },
          tags: { var: 'tags' },
        },
      },
      {
        kind: 'module',
        id: 'iam_policy',
        use: { module_id: 'aws-iam-policy', version: 'v1.0.0' },
        inputs: {
          policy_name: { expr: { lang: 'hcl', value: '"${var.role_name}-policy"' } },
          policy_document: {
            expr: {
              lang: 'hcl',
              value:
                'jsonencode({Version = "2012-10-17", Statement = [{Effect = "Allow", Action = ["logs:*"], Resource = "*"}]})',
            },
          },
          tags: { var: 'tags' },
        },
      },
      {
        kind: 'module',
        id: 'iam_policy_attachment',
        use: { module_id: 'aws-iam-role-policy-attachment', version: 'v1.0.0' },
        inputs: {
          role_name: { out: { module: 'iam_role', name: 'role_name' } },
          policy_arn: { out: { module: 'iam_policy', name: 'arn' } },
        },
        depends_on: ['iam_role', 'iam_policy'],
      },
    ],
    {
      'aws-iam-role@v2.0.0': iamRoleDef,
      'aws-iam-policy@v1.0.0': iamPolicyDef,
      'aws-iam-role-policy-attachment@v1.0.0': iamAttachDef,
    },
    {},
    {
      role_arn: { out: { module: 'iam_role', name: 'arn' } },
      role_name: { out: { module: 'iam_role', name: 'role_name' } },
      policy_arn: { out: { module: 'iam_policy', name: 'arn' } },
    },
    [
      { name: 'role_name', type: 'string', required: true, description: 'Name of the IAM role' },
      { name: 'tags', type: 'map(string)', required: false, default: {} },
    ],
  );

  // Group iam_policy + iam_policy_attachment into cloudwatch_logs_policy
  state = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'root@v1.0.0',
    instance_ids: ['iam_policy', 'iam_policy_attachment'],
    composite_id: 'cloudwatch_logs_policy',
  });

  // ── Verify parent structure ──
  const parentInstances = getInstances(state, 'root@v1.0.0');
  expect(parentInstances).toHaveLength(2);
  expect(parentInstances.find((i) => i.id === 'iam_role')).toBeDefined();
  expect(parentInstances.find((i) => i.id === 'cloudwatch_logs_policy')).toBeDefined();

  // ── Verify sub-composite structure ──
  const subInstances = getInstances(state, 'cloudwatch_logs_policy@v1.0.0');
  expect(subInstances).toHaveLength(2);

  // Internal wiring preserved: attachment.policy_arn → iam_policy.arn
  const attachInst = getInst(state, 'cloudwatch_logs_policy@v1.0.0', 'iam_policy_attachment');
  expect(attachInst.inputs.policy_arn).toEqual({ out: { module: 'iam_policy', name: 'arn' } });

  // Boundary-in: attachment.role_name was wired from iam_role (external)
  // → now a var binding in sub-composite
  expect(attachInst.inputs.role_name).toEqual({ var: 'iam_role_role_name' });

  // Sub-composite interface has input for iam_role.role_name + var passthrough for tags
  const subDef = state.modules['cloudwatch_logs_policy@v1.0.0'];
  expect(subDef.interface.inputs.find((i) => i.name === 'iam_role_role_name')).toBeDefined();
  expect(subDef.interface.inputs.find((i) => i.name === 'tags')).toBeDefined();

  // Parent's composite instance wires iam_role.role_name → cloudwatch_logs_policy input
  const compositeInst = getInst(state, 'root@v1.0.0', 'cloudwatch_logs_policy');
  expect(compositeInst.inputs.iam_role_role_name).toEqual({
    out: { module: 'iam_role', name: 'role_name' },
  });
  expect(compositeInst.inputs.tags).toEqual({ var: 'tags' });

  // ── Verify parent exports are rewired ──
  const rootExports = getExports(state, 'root@v1.0.0');
  // role_arn still references iam_role (not grouped)
  expect(rootExports.role_arn).toEqual({ out: { module: 'iam_role', name: 'arn' } });
  // policy_arn now references the sub-composite
  expect(rootExports.policy_arn).toEqual({
    out: { module: 'cloudwatch_logs_policy', name: 'iam_policy_arn' },
  });

  // ── Verify round-trip ──
  const bundle = toBundle(state);
  expect(Object.keys(bundle.modules)).toContain('cloudwatch_logs_policy@v1.0.0');
  const { workspace: parsed } = fromBundle(bundle);
  expect(Object.keys(parsed.modules)).toContain('cloudwatch_logs_policy@v1.0.0');
});

// ══════════════════════════════════════════════════════════════════════
// GROUP_INTO_COMPOSITE: non-composite parent returns state unchanged
// ══════════════════════════════════════════════════════════════════════

test('GROUP_INTO_COMPOSITE: non-existent module_key returns state unchanged', () => {
  const state = makeWorkspace([
    { kind: 'module', id: 'a', use: { module_id: 'mod_a', version: 'v1.0.0' }, inputs: {} },
  ]);
  const next = workspaceReducer(state, {
    type: 'GROUP_INTO_COMPOSITE',
    module_key: 'nonexistent@v1.0.0',
    instance_ids: ['a'],
    composite_id: 'sub',
  });
  expect(next).toBe(state);
});
