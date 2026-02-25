import { test, expect, describe } from 'vitest';
import { inferVariables, inferOutputDefs, inferRequiredProviders } from '../utils/infer';
import type { Instance, ModuleDef, OutputExport } from '../types/ir';
import type { ResolvedSchema } from '../utils/resolve';

// ══════════════════════════════════════════════════════════════════════
// inferVariables
// ══════════════════════════════════════════════════════════════════════

describe('inferVariables', () => {
  test('collects unique var bindings from instances', () => {
    const instances: Instance[] = [
      {
        kind: 'module',
        id: 'a',
        use: { module_id: 'mod-a', version: 'v1' },
        inputs: { region: { var: 'region' } },
      },
      {
        kind: 'module',
        id: 'b',
        use: { module_id: 'mod-b', version: 'v1' },
        inputs: { env: { var: 'env' } },
      },
    ];
    const result = inferVariables(instances);
    expect(result).toEqual([
      { name: 'region', type: 'string', required: true },
      { name: 'env', type: 'string', required: true },
    ]);
  });

  test('deduplicates same var name across instances', () => {
    const instances: Instance[] = [
      {
        kind: 'module',
        id: 'a',
        use: { module_id: 'mod-a', version: 'v1' },
        inputs: { region: { var: 'region' } },
      },
      {
        kind: 'module',
        id: 'b',
        use: { module_id: 'mod-b', version: 'v1' },
        inputs: { region: { var: 'region' } },
      },
    ];
    const result = inferVariables(instances);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('region');
  });

  test('returns empty array when no var bindings exist', () => {
    const instances: Instance[] = [
      {
        kind: 'module',
        id: 'a',
        use: { module_id: 'mod-a', version: 'v1' },
        inputs: { bucket: { lit: 'my-bucket' } },
      },
    ];
    expect(inferVariables(instances)).toEqual([]);
  });

  test('only var bindings produce variables (mixed binding types)', () => {
    const instances: Instance[] = [
      {
        kind: 'module',
        id: 'a',
        use: { module_id: 'mod-a', version: 'v1' },
        inputs: {
          region: { var: 'region' },
          bucket: { lit: 'my-bucket' },
          vpc_id: { out: { module: 'vpc', name: 'id' } },
        },
      },
    ];
    const result = inferVariables(instances);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('region');
  });
});

// ══════════════════════════════════════════════════════════════════════
// inferOutputDefs
// ══════════════════════════════════════════════════════════════════════

describe('inferOutputDefs', () => {
  const instances: Instance[] = [
    {
      kind: 'module',
      id: 'my_bucket',
      use: { module_id: 'aws-s3', version: 'v1' },
      inputs: {},
    },
  ];

  const resolveSchema = (inst: Instance): ResolvedSchema => {
    if (inst.id === 'my_bucket') {
      return {
        inputs: [],
        outputs: [
          { name: 'arn', type: 'string' },
          { name: 'id', type: 'string' },
        ],
      };
    }
    return { inputs: [], outputs: [] };
  };

  test('creates OutputDef with correct type from source schema', () => {
    const exports: Record<string, OutputExport> = {
      bucket_arn: { out: { module: 'my_bucket', name: 'arn' } },
    };
    const result = inferOutputDefs(exports, instances, resolveSchema);
    expect(result).toEqual([{ name: 'bucket_arn', type: 'string' }]);
  });

  test('falls back to type string when source cannot be resolved', () => {
    const exports: Record<string, OutputExport> = {
      mystery: { out: { module: 'nonexistent', name: 'value' } },
    };
    const result = inferOutputDefs(exports, instances, resolveSchema);
    expect(result).toEqual([{ name: 'mystery', type: 'string' }]);
  });

  test('returns empty array for empty exports', () => {
    expect(inferOutputDefs({}, instances, resolveSchema)).toEqual([]);
  });

  test('skips non-out exports', () => {
    const exports: Record<string, OutputExport> = {
      static_val: { lit: 'hello' },
      bucket_arn: { out: { module: 'my_bucket', name: 'arn' } },
    };
    const result = inferOutputDefs(exports, instances, resolveSchema);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bucket_arn');
  });
});

// ══════════════════════════════════════════════════════════════════════
// inferRequiredProviders
// ══════════════════════════════════════════════════════════════════════

describe('inferRequiredProviders', () => {
  function makeLeafDef(id: string, version: string, terraform?: ModuleDef['terraform']): ModuleDef {
    return {
      schema_version: '1.0',
      kind: 'module_def',
      id,
      version,
      interface: { inputs: [], outputs: [] },
      impl: { kind: 'leaf', source: { kind: 'registry' } },
      ...(terraform ? { terraform } : {}),
    };
  }

  test('merges required_providers from non-entry modules', () => {
    const modules: Record<string, ModuleDef> = {
      'entry@v1': makeLeafDef('entry', 'v1', {
        required_providers: { aws: { source: 'hashicorp/aws', version: '~> 4.0' } },
      }),
      'mod-a@v1': makeLeafDef('mod-a', 'v1', {
        required_providers: { aws: { source: 'hashicorp/aws', version: '~> 5.0' } },
      }),
      'mod-b@v1': makeLeafDef('mod-b', 'v1', {
        required_providers: { google: { source: 'hashicorp/google', version: '~> 4.0' } },
      }),
    };
    const result = inferRequiredProviders(modules, 'entry@v1');
    expect(result).toEqual({
      aws: { source: 'hashicorp/aws', version: '~> 5.0' },
      google: { source: 'hashicorp/google', version: '~> 4.0' },
    });
  });

  test('returns empty object when no modules have required_providers', () => {
    const modules: Record<string, ModuleDef> = {
      'entry@v1': makeLeafDef('entry', 'v1'),
      'mod-a@v1': makeLeafDef('mod-a', 'v1'),
    };
    expect(inferRequiredProviders(modules, 'entry@v1')).toEqual({});
  });

  test('skips entry module', () => {
    const modules: Record<string, ModuleDef> = {
      'entry@v1': makeLeafDef('entry', 'v1', {
        required_providers: { aws: { source: 'hashicorp/aws', version: '~> 4.0' } },
      }),
    };
    expect(inferRequiredProviders(modules, 'entry@v1')).toEqual({});
  });
});
