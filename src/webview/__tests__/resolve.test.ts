import { test, expect, describe } from 'vitest';
import { resolveSchema, resolveNodeType, resolveModuleDef, resolveIconUrl } from '../utils/resolve';
import type { WorkspaceState } from '../types/workspace';
import type { Instance, ModuleDef, ModuleInstance, ResourceInstance } from '../types/ir';

// ══════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════

function makeLeafDef(id: string, version: string): ModuleDef {
  return {
    schema_version: '1.0',
    kind: 'module_def',
    id,
    version,
    interface: {
      inputs: [{ name: 'vpc_id', type: 'string', required: true }],
      outputs: [{ name: 'arn', type: 'string' }],
    },
    impl: { kind: 'leaf', source: { kind: 'registry' } },
  };
}

function makeCompositeDef(id: string, version: string): ModuleDef {
  return {
    schema_version: '1.0',
    kind: 'module_def',
    id,
    version,
    interface: {
      inputs: [{ name: 'region', type: 'string', required: true }],
      outputs: [{ name: 'cluster_id', type: 'string' }],
    },
    impl: {
      kind: 'composite',
      graph: { instances: [], exports: { outputs: {} } },
    },
  };
}

function makeWorkspace(modules: Record<string, ModuleDef>): WorkspaceState {
  const firstKey = Object.keys(modules)[0] ?? 'root@v1.0.0';
  const [id, version] = firstKey.split('@');
  return {
    schema_version: '1.0',
    kind: 'module_bundle',
    entry: { module_id: id, version },
    modules,
    layouts: {},
  };
}

const leafInst: ModuleInstance = {
  kind: 'module',
  id: 'my_bucket',
  use: { module_id: 'aws-s3-bucket', version: 'v1.2.0' },
  inputs: {},
};

const compositeInst: ModuleInstance = {
  kind: 'module',
  id: 'my_stack',
  use: { module_id: 'iam-stack', version: 'v1.0.0' },
  inputs: {},
};

const resourceInst: ResourceInstance = {
  kind: 'resource',
  id: 'my_resource',
  type: 'aws_s3_bucket',
  inputs: {},
};

// ══════════════════════════════════════════════════════════════════════
// resolveModuleDef
// ══════════════════════════════════════════════════════════════════════

describe('resolveModuleDef', () => {
  test('returns exact match by module_key', () => {
    const def = makeLeafDef('aws-s3-bucket', 'v1.2.0');
    const ws = makeWorkspace({ 'aws-s3-bucket@v1.2.0': def });
    expect(resolveModuleDef(ws, leafInst)).toBe(def);
  });

  test('falls back to id match when exact key missing', () => {
    const def = makeLeafDef('aws-s3-bucket', 'v1.0.0');
    const ws = makeWorkspace({ 'aws-s3-bucket@v1.0.0': def });
    // Instance references v1.2.0 but only v1.0.0 exists
    expect(resolveModuleDef(ws, leafInst)).toBe(def);
  });

  test('returns undefined for non-module instances', () => {
    const ws = makeWorkspace({});
    expect(resolveModuleDef(ws, resourceInst)).toBeUndefined();
  });

  test('returns undefined when no module matches', () => {
    const ws = makeWorkspace({ 'unrelated@v1.0.0': makeLeafDef('unrelated', 'v1.0.0') });
    expect(resolveModuleDef(ws, leafInst)).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// resolveSchema
// ══════════════════════════════════════════════════════════════════════

describe('resolveSchema', () => {
  test('returns inputs and outputs from resolved module', () => {
    const def = makeLeafDef('aws-s3-bucket', 'v1.2.0');
    const ws = makeWorkspace({ 'aws-s3-bucket@v1.2.0': def });
    const schema = resolveSchema(ws, leafInst);
    expect(schema.inputs).toHaveLength(1);
    expect(schema.inputs[0].name).toBe('vpc_id');
    expect(schema.outputs).toHaveLength(1);
    expect(schema.outputs[0].name).toBe('arn');
  });

  test('returns empty schema for unresolved instance', () => {
    const ws = makeWorkspace({});
    const schema = resolveSchema(ws, leafInst);
    expect(schema.inputs).toEqual([]);
    expect(schema.outputs).toEqual([]);
  });

  test('returns empty schema for resource instance', () => {
    const ws = makeWorkspace({});
    const schema = resolveSchema(ws, resourceInst);
    expect(schema.inputs).toEqual([]);
    expect(schema.outputs).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════
// resolveNodeType
// ══════════════════════════════════════════════════════════════════════

describe('resolveNodeType', () => {
  test('returns compositeNode for composite module', () => {
    const def = makeCompositeDef('iam-stack', 'v1.0.0');
    const ws = makeWorkspace({ 'iam-stack@v1.0.0': def });
    expect(resolveNodeType(ws, compositeInst)).toBe('compositeNode');
  });

  test('returns moduleNode for leaf module', () => {
    const def = makeLeafDef('aws-s3-bucket', 'v1.2.0');
    const ws = makeWorkspace({ 'aws-s3-bucket@v1.2.0': def });
    expect(resolveNodeType(ws, leafInst)).toBe('moduleNode');
  });

  test('returns moduleNode for resource instance', () => {
    const ws = makeWorkspace({});
    expect(resolveNodeType(ws, resourceInst)).toBe('moduleNode');
  });

  test('returns moduleNode when module def is missing', () => {
    const ws = makeWorkspace({});
    expect(resolveNodeType(ws, leafInst)).toBe('moduleNode');
  });
});

// ══════════════════════════════════════════════════════════════════════
// resolveIconUrl
// ══════════════════════════════════════════════════════════════════════

describe('resolveIconUrl', () => {
  const iconMap: Record<string, string> = {
    'aws-s3-bucket@v1.2.0': 'https://registry.example.com/icons/s3.svg',
    'iam-stack@v1.0.0': 'https://registry.example.com/icons/iam.svg',
  };

  test('returns icon URL for module instance with matching entry', () => {
    expect(resolveIconUrl(leafInst, iconMap)).toBe('https://registry.example.com/icons/s3.svg');
  });

  test('returns icon URL for composite module instance', () => {
    expect(resolveIconUrl(compositeInst, iconMap)).toBe(
      'https://registry.example.com/icons/iam.svg',
    );
  });

  test('returns undefined for module instance without matching entry', () => {
    const unknownInst: ModuleInstance = {
      kind: 'module',
      id: 'my_db',
      use: { module_id: 'rds-instance', version: 'v1.0.0' },
      inputs: {},
    };
    expect(resolveIconUrl(unknownInst, iconMap)).toBeUndefined();
  });

  test('returns undefined for resource instance', () => {
    expect(resolveIconUrl(resourceInst, iconMap)).toBeUndefined();
  });

  test('returns undefined for data instance', () => {
    const dataInst: Instance = {
      kind: 'data',
      id: 'my_data',
      type: 'aws_caller_identity',
      inputs: {},
    };
    expect(resolveIconUrl(dataInst, iconMap)).toBeUndefined();
  });

  test('returns undefined with empty icon map', () => {
    expect(resolveIconUrl(leafInst, {})).toBeUndefined();
  });

  test('matches exact module_id and version', () => {
    // Same module_id, different version — should NOT match
    const wrongVersionInst: ModuleInstance = {
      kind: 'module',
      id: 'my_bucket',
      use: { module_id: 'aws-s3-bucket', version: 'v2.0.0' },
      inputs: {},
    };
    expect(resolveIconUrl(wrongVersionInst, iconMap)).toBeUndefined();
  });
});
