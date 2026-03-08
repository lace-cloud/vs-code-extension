import { test, expect, describe } from 'vitest';
import { resolveSchema, resolveModuleDef, resolveIconUrl } from '../utils/resolve';
import type { WorkspaceState } from '../types/workspace';
import type { Module, Use, Resource } from '../types/ir';

// ══════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════

function makeLeafDef(id: string, version: string): Module {
  return {
    id,
    version,
    interface: {
      inputs: [{ name: 'vpc_id', type: 'string', required: true }],
      outputs: [{ name: 'arn', type: 'string' }],
    },
    source: { kind: 'registry' },
    exports: { outputs: {} },
  };
}

function makeWorkspace(modules: Record<string, Module>): WorkspaceState {
  const firstKey = Object.keys(modules)[0] ?? 'root@v1.0.0';
  return {
    schema_version: '1.0',
    kind: 'bundle',
    entry: firstKey,
    modules,
    layouts: {},
  };
}

const leafInst: Use = {
  id: 'my_bucket',
  module: 'aws-s3-bucket@v1.2.0',
  inputs: {},
};

const compositeInst: Use = {
  id: 'my_stack',
  module: 'iam-stack@v1.0.0',
  inputs: {},
};

const resourceInst: Resource = {
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

  test('returns undefined when exact key missing', () => {
    const def = makeLeafDef('aws-s3-bucket', 'v1.0.0');
    const ws = makeWorkspace({ 'aws-s3-bucket@v1.0.0': def });
    // Instance references v1.2.0 but only v1.0.0 exists — no fallback
    expect(resolveModuleDef(ws, leafInst)).toBeUndefined();
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
    const unknownInst: Use = {
      id: 'my_db',
      module: 'rds-instance@v1.0.0',
      inputs: {},
    };
    expect(resolveIconUrl(unknownInst, iconMap)).toBeUndefined();
  });

  test('returns undefined for resource instance', () => {
    expect(resolveIconUrl(resourceInst, iconMap)).toBeUndefined();
  });

  test('matches exact module key', () => {
    // Same module_id, different version — should NOT match
    const wrongVersionInst: Use = {
      id: 'my_bucket',
      module: 'aws-s3-bucket@v2.0.0',
    };
    expect(resolveIconUrl(wrongVersionInst, iconMap)).toBeUndefined();
  });
});
