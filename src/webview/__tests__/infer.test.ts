import { test, expect, describe } from 'vitest';
import {
  inferVariables,
  inferOutputExports,
  inferOutputDefs,
  inferRequiredProviders,
} from '../utils/infer';
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

  test('only var bindings produce variables (lit and out ignored)', () => {
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
// inferOutputExports
// ══════════════════════════════════════════════════════════════════════

describe('inferOutputExports', () => {
  test('creates exports from all instance schema outputs', () => {
    const instances: Instance[] = [
      {
        kind: 'module',
        id: 'my_bucket',
        use: { module_id: 'aws-s3', version: 'v1' },
        inputs: {},
      },
    ];
    const resolveSchema = (): ResolvedSchema => ({
      inputs: [],
      outputs: [
        { name: 'arn', type: 'string' },
        { name: 'id', type: 'string' },
      ],
    });
    const result = inferOutputExports(instances, resolveSchema);
    expect(result).toEqual({
      my_bucket_arn: { out: { module: 'my_bucket', name: 'arn' } },
      my_bucket_id: { out: { module: 'my_bucket', name: 'id' } },
    });
  });

  test('returns empty for instances with no resolvable outputs', () => {
    const instances: Instance[] = [
      {
        kind: 'resource',
        id: 'my_resource',
        type: 'aws_instance',
        inputs: {},
      },
    ];
    const resolveSchema = (): ResolvedSchema => ({
      inputs: [],
      outputs: [],
    });
    expect(inferOutputExports(instances, resolveSchema)).toEqual({});
  });

  test('handles multiple instances', () => {
    const instances: Instance[] = [
      {
        kind: 'module',
        id: 'bucket',
        use: { module_id: 'aws-s3', version: 'v1' },
        inputs: {},
      },
      {
        kind: 'module',
        id: 'vpc',
        use: { module_id: 'aws-vpc', version: 'v1' },
        inputs: {},
      },
    ];
    const resolveSchema = (inst: Instance): ResolvedSchema => {
      if (inst.id === 'bucket') {
        return { inputs: [], outputs: [{ name: 'arn', type: 'string' }] };
      }
      if (inst.id === 'vpc') {
        return { inputs: [], outputs: [{ name: 'id', type: 'string' }] };
      }
      return { inputs: [], outputs: [] };
    };
    const result = inferOutputExports(instances, resolveSchema);
    expect(result).toEqual({
      bucket_arn: { out: { module: 'bucket', name: 'arn' } },
      vpc_id: { out: { module: 'vpc', name: 'id' } },
    });
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

  test('inferOutputExports → inferOutputDefs pipeline produces typed output defs', () => {
    const inferred = inferOutputExports(instances, resolveSchema);
    const defs = inferOutputDefs(inferred, instances, resolveSchema);
    expect(defs).toEqual([
      { name: 'my_bucket_arn', type: 'string' },
      { name: 'my_bucket_id', type: 'string' },
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Generate-time enrichment (integration: mirrors Canvas.tsx onGenerate)
// ══════════════════════════════════════════════════════════════════════

describe('generate-time output enrichment', () => {
  const instances: Instance[] = [
    {
      kind: 'module',
      id: 'bucket',
      use: { module_id: 'aws-s3', version: 'v1' },
      inputs: { name: { var: 'bucket_name' } },
    },
    {
      kind: 'module',
      id: 'vpc',
      use: { module_id: 'aws-vpc', version: 'v1' },
      inputs: {},
    },
  ];

  const resolve = (inst: Instance): ResolvedSchema => {
    if (inst.id === 'bucket') {
      return {
        inputs: [{ name: 'name', type: 'string', required: true }],
        outputs: [
          { name: 'arn', type: 'string' },
          { name: 'id', type: 'string' },
        ],
      };
    }
    if (inst.id === 'vpc') {
      return {
        inputs: [],
        outputs: [{ name: 'vpc_id', type: 'string' }],
      };
    }
    return { inputs: [], outputs: [] };
  };

  test('manual exports override inferred exports for same key', () => {
    const manualExports: Record<string, OutputExport> = {
      // Override the auto-inferred bucket_arn with a custom source
      bucket_arn: { out: { module: 'vpc', name: 'vpc_id' } },
    };

    const inferredExports = inferOutputExports(instances, resolve);
    const mergedExports = { ...inferredExports, ...manualExports };

    // Manual export wins for 'bucket_arn'
    expect(mergedExports['bucket_arn']).toEqual({ out: { module: 'vpc', name: 'vpc_id' } });
    // Inferred exports for other keys are preserved
    expect(mergedExports['bucket_id']).toEqual({ out: { module: 'bucket', name: 'id' } });
    expect(mergedExports['vpc_vpc_id']).toEqual({ out: { module: 'vpc', name: 'vpc_id' } });
  });

  test('enriched bundle contains both graph.exports wiring and interface.outputs metadata', () => {
    const existingExports: Record<string, OutputExport> = {};

    const inferredExports = inferOutputExports(instances, resolve);
    const mergedExports = { ...inferredExports, ...existingExports };
    const outputDefs = inferOutputDefs(mergedExports, instances, resolve);

    // Wiring: every instance output has an export entry
    expect(Object.keys(mergedExports)).toHaveLength(3);
    expect(mergedExports['bucket_arn']).toEqual({ out: { module: 'bucket', name: 'arn' } });
    expect(mergedExports['bucket_id']).toEqual({ out: { module: 'bucket', name: 'id' } });
    expect(mergedExports['vpc_vpc_id']).toEqual({ out: { module: 'vpc', name: 'vpc_id' } });

    // Type metadata: one OutputDef per export, with resolved types
    expect(outputDefs).toHaveLength(3);
    expect(outputDefs).toContainEqual({ name: 'bucket_arn', type: 'string' });
    expect(outputDefs).toContainEqual({ name: 'bucket_id', type: 'string' });
    expect(outputDefs).toContainEqual({ name: 'vpc_vpc_id', type: 'string' });
  });

  test('empty graph produces no exports and no output defs', () => {
    const emptyInstances: Instance[] = [];
    const inferredExports = inferOutputExports(emptyInstances, resolve);
    const mergedExports = { ...inferredExports };
    const outputDefs = inferOutputDefs(mergedExports, emptyInstances, resolve);

    expect(mergedExports).toEqual({});
    expect(outputDefs).toEqual([]);
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
      source: { kind: 'registry' },
      graph: { instances: [], exports: { outputs: {} } },
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
