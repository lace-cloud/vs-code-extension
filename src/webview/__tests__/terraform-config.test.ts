// src/webview/__tests__/terraform-config.test.ts
import { test, expect, describe } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { workspaceReducer } from '../state/reducer';
import { fromBundle, toBundle } from '../utils/bundle';
import { validateWorkspace } from '../utils/validate';
import type { WorkspaceState } from '../types/workspace';
import type { Instance, ModuleDef, ModuleBundle } from '../types/ir';

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

function getGraph(state: WorkspaceState, key: string) {
  const def = state.modules[key];
  if (def.impl.kind !== 'composite') throw new Error('Not composite');
  return def.impl.graph;
}

function getInst(state: WorkspaceState, id: string, key = 'root@v1.0.0'): Instance {
  const graph = getGraph(state, key);
  const inst = graph.instances.find((i) => i.id === id);
  if (!inst) throw new Error(`Instance ${id} not found`);
  return inst;
}

// ══════════════════════════════════════════════════════════════════════
// SET_TERRAFORM
// ══════════════════════════════════════════════════════════════════════

describe('SET_TERRAFORM', () => {
  test('sets terraform block on a module', () => {
    const ws = makeWorkspace([]);
    const result = workspaceReducer(ws, {
      type: 'SET_TERRAFORM',
      module_key: 'root@v1.0.0',
      terraform: {
        required_version: '>= 1.5',
        required_providers: {
          aws: { source: 'hashicorp/aws', version: '~> 5.0' },
        },
        backend: {
          type: 's3',
          config: { bucket: 'my-state', key: 'tf.tfstate', region: 'us-east-1', encrypt: true },
        },
      },
    });

    expect(result.modules['root@v1.0.0'].terraform).toBeDefined();
    expect(result.modules['root@v1.0.0'].terraform!.required_version).toBe('>= 1.5');
    expect(result.modules['root@v1.0.0'].terraform!.required_providers!.aws.source).toBe(
      'hashicorp/aws',
    );
    expect(result.modules['root@v1.0.0'].terraform!.backend!.type).toBe('s3');
    expect(result.modules['root@v1.0.0'].terraform!.backend!.config.encrypt).toBe(true);
  });

  test('ignores unknown module key', () => {
    const ws = makeWorkspace([]);
    const result = workspaceReducer(ws, {
      type: 'SET_TERRAFORM',
      module_key: 'nonexistent@v1.0.0',
      terraform: { required_version: '>= 1.5' },
    });
    expect(result).toBe(ws);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SET_PROVIDERS
// ══════════════════════════════════════════════════════════════════════

describe('SET_PROVIDERS', () => {
  test('sets provider configs on a module', () => {
    const ws = makeWorkspace([]);
    const result = workspaceReducer(ws, {
      type: 'SET_PROVIDERS',
      module_key: 'root@v1.0.0',
      providers: [
        { name: 'aws', config: { region: 'us-east-1' } },
        { name: 'aws', alias: 'west', config: { region: 'us-west-2' } },
      ],
    });

    expect(result.modules['root@v1.0.0'].providers).toHaveLength(2);
    expect(result.modules['root@v1.0.0'].providers![0].name).toBe('aws');
    expect(result.modules['root@v1.0.0'].providers![1].alias).toBe('west');
  });

  test('sets empty providers array', () => {
    let ws = makeWorkspace([]);
    ws = workspaceReducer(ws, {
      type: 'SET_PROVIDERS',
      module_key: 'root@v1.0.0',
      providers: [{ name: 'aws', config: { region: 'us-east-1' } }],
    });
    expect(ws.modules['root@v1.0.0'].providers).toHaveLength(1);

    ws = workspaceReducer(ws, {
      type: 'SET_PROVIDERS',
      module_key: 'root@v1.0.0',
      providers: [],
    });
    expect(ws.modules['root@v1.0.0'].providers).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SET_LOCALS
// ══════════════════════════════════════════════════════════════════════

describe('SET_LOCALS', () => {
  test('sets locals on a composite graph', () => {
    const ws = makeWorkspace([]);
    const result = workspaceReducer(ws, {
      type: 'SET_LOCALS',
      module_key: 'root@v1.0.0',
      locals: [
        { name: 'common_tags', value: { lit: { ManagedBy: 'lace', Stack: 'iam-stack' } } },
        {
          name: 'full_role_name',
          value: { expr: { lang: 'hcl', value: '"${var.environment}-${var.role_name}"' } },
        },
      ],
    });

    const graph = getGraph(result, 'root@v1.0.0');
    expect(graph.locals).toHaveLength(2);
    expect(graph.locals![0].name).toBe('common_tags');
    expect(graph.locals![1].name).toBe('full_role_name');
  });

  test('clears locals when empty array', () => {
    let ws = makeWorkspace([]);
    ws = workspaceReducer(ws, {
      type: 'SET_LOCALS',
      module_key: 'root@v1.0.0',
      locals: [{ name: 'foo', value: { lit: 'bar' } }],
    });
    expect(getGraph(ws, 'root@v1.0.0').locals).toHaveLength(1);

    ws = workspaceReducer(ws, {
      type: 'SET_LOCALS',
      module_key: 'root@v1.0.0',
      locals: [],
    });
    expect(getGraph(ws, 'root@v1.0.0').locals).toBeUndefined();
  });

  test('ignores non-composite module', () => {
    const ws = makeWorkspace([], {
      'leaf@v1.0.0': {
        schema_version: '1.0',
        kind: 'module_def',
        id: 'leaf',
        version: 'v1.0.0',
        interface: { inputs: [], outputs: [] },
        impl: { kind: 'leaf', source: { kind: 'registry', ref: 'leaf/aws/v1.0.0' } },
      },
    });
    const result = workspaceReducer(ws, {
      type: 'SET_LOCALS',
      module_key: 'leaf@v1.0.0',
      locals: [{ name: 'foo', value: { lit: 'bar' } }],
    });
    expect(result).toBe(ws);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SET_DEPENDS_ON
// ══════════════════════════════════════════════════════════════════════

describe('SET_DEPENDS_ON', () => {
  test('sets depends_on on an instance', () => {
    const ws = makeWorkspace([
      { kind: 'module', id: 'a', use: { module_id: 'x', version: 'v1' }, inputs: {} },
      { kind: 'module', id: 'b', use: { module_id: 'x', version: 'v1' }, inputs: {} },
      { kind: 'module', id: 'c', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    ]);

    const result = workspaceReducer(ws, {
      type: 'SET_DEPENDS_ON',
      module_key: 'root@v1.0.0',
      instance_id: 'c',
      depends_on: ['module.a', 'module.b'],
    });

    const inst = getInst(result, 'c');
    expect(inst.depends_on).toEqual(['module.a', 'module.b']);
  });

  test('clears depends_on when empty array', () => {
    const ws = makeWorkspace([
      {
        kind: 'module',
        id: 'a',
        use: { module_id: 'x', version: 'v1' },
        inputs: {},
        depends_on: ['module.b'],
      },
      { kind: 'module', id: 'b', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    ]);

    const result = workspaceReducer(ws, {
      type: 'SET_DEPENDS_ON',
      module_key: 'root@v1.0.0',
      instance_id: 'a',
      depends_on: [],
    });

    const inst = getInst(result, 'a');
    expect(inst.depends_on).toBeUndefined();
  });

  test('only affects targeted instance', () => {
    const ws = makeWorkspace([
      {
        kind: 'module',
        id: 'a',
        use: { module_id: 'x', version: 'v1' },
        inputs: {},
        depends_on: ['module.c'],
      },
      { kind: 'module', id: 'b', use: { module_id: 'x', version: 'v1' }, inputs: {} },
      { kind: 'module', id: 'c', use: { module_id: 'x', version: 'v1' }, inputs: {} },
    ]);

    const result = workspaceReducer(ws, {
      type: 'SET_DEPENDS_ON',
      module_key: 'root@v1.0.0',
      instance_id: 'b',
      depends_on: ['module.a'],
    });

    expect(getInst(result, 'a').depends_on).toEqual(['module.c']); // unchanged
    expect(getInst(result, 'b').depends_on).toEqual(['module.a']); // set
  });
});

// ══════════════════════════════════════════════════════════════════════
// SET_ENVIRONMENTS
// ══════════════════════════════════════════════════════════════════════

describe('SET_ENVIRONMENTS', () => {
  test('sets environments on workspace', () => {
    const ws = makeWorkspace([]);
    const result = workspaceReducer(ws, {
      type: 'SET_ENVIRONMENTS',
      environments: {
        dev: { role_name: 'dev-role', environment: 'dev', max_session_duration: 3600 },
        prod: { role_name: 'prod-role', environment: 'prod', max_session_duration: 7200 },
      },
    });

    expect(result.environments).toBeDefined();
    expect(result.environments!.dev.role_name).toBe('dev-role');
    expect(result.environments!.prod.max_session_duration).toBe(7200);
  });

  test('clears environments with undefined', () => {
    let ws = makeWorkspace([]);
    ws = workspaceReducer(ws, {
      type: 'SET_ENVIRONMENTS',
      environments: { dev: { foo: 'bar' } },
    });
    expect(ws.environments).toBeDefined();

    ws = workspaceReducer(ws, {
      type: 'SET_ENVIRONMENTS',
      environments: undefined,
    });
    expect(ws.environments).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// SET_ENVIRONMENT_BACKENDS
// ══════════════════════════════════════════════════════════════════════

describe('SET_ENVIRONMENT_BACKENDS', () => {
  test('sets environment backends on workspace', () => {
    const ws = makeWorkspace([]);
    const result = workspaceReducer(ws, {
      type: 'SET_ENVIRONMENT_BACKENDS',
      backends: {
        dev: { type: 's3', config: { bucket: 'my-state-dev', key: 'tf.tfstate' } },
        prod: {
          type: 's3',
          config: { bucket: 'my-state-prod', key: 'tf.tfstate', dynamodb_table: 'terraform-locks' },
        },
      },
    });

    expect(result.environment_backends).toBeDefined();
    expect(result.environment_backends!.dev.config.bucket).toBe('my-state-dev');
    expect(result.environment_backends!.prod.config.dynamodb_table).toBe('terraform-locks');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Full bundle round-trip
// ══════════════════════════════════════════════════════════════════════

describe('Full bundle with terraform — round-trip', () => {
  test('fromBundle parses full_bundle_with_terraform.json', () => {
    const raw = loadFixture('full_bundle_with_terraform.json') as ModuleBundle;
    const { workspace, errors } = fromBundle(raw);
    expect(errors).toHaveLength(0);

    // Entry module loaded
    const entryKey = `${raw.entry.module_id}@${raw.entry.version}`;
    const entryDef = workspace.modules[entryKey];
    expect(entryDef).toBeDefined();

    // Terraform block present
    expect(entryDef.terraform).toBeDefined();
    expect(entryDef.terraform!.required_version).toBe('>= 1.5');
    expect(entryDef.terraform!.required_providers!.aws.source).toBe('hashicorp/aws');
    expect(entryDef.terraform!.backend!.type).toBe('s3');

    // Providers present
    expect(entryDef.providers).toHaveLength(2);
    expect(entryDef.providers![0].name).toBe('aws');
    expect(entryDef.providers![1].alias).toBe('west');

    // Locals present
    if (entryDef.impl.kind === 'composite') {
      expect(entryDef.impl.graph.locals).toHaveLength(2);
      expect(entryDef.impl.graph.locals![0].name).toBe('common_tags');
    }

    // Environments present
    expect(workspace.environments).toBeDefined();
    expect(workspace.environments!.dev).toBeDefined();
    expect(workspace.environments!.prod).toBeDefined();

    // Environment backends present
    expect(workspace.environment_backends).toBeDefined();
    expect(workspace.environment_backends!.dev.type).toBe('s3');
  });

  test('toBundle preserves terraform config', () => {
    const raw = loadFixture('full_bundle_with_terraform.json') as ModuleBundle;
    const { workspace } = fromBundle(raw);
    const bundle = toBundle(workspace);

    const entryKey = `${raw.entry.module_id}@${raw.entry.version}`;
    const entryDef = bundle.modules[entryKey];

    // Terraform block round-trips
    expect(entryDef.terraform!.required_version).toBe('>= 1.5');
    expect(entryDef.terraform!.required_providers!.aws.version).toBe('~> 5.0');
    expect(entryDef.terraform!.backend!.config.encrypt).toBe(true);

    // Providers round-trip
    expect(entryDef.providers).toHaveLength(2);

    // Locals round-trip (with wires injected)
    if (entryDef.impl.kind === 'composite') {
      expect(entryDef.impl.graph.locals).toHaveLength(2);
      // Wires should be derived
      expect(entryDef.impl.graph.wires).toBeDefined();
      expect(entryDef.impl.graph.wires!.length).toBeGreaterThan(0);
    }

    // Environments round-trip
    expect(bundle.environments).toBeDefined();
    expect(bundle.environments!.dev.role_name).toBe('dev-lambda-role');
    expect(bundle.environments!.prod.max_session_duration).toBe(7200);

    // Environment backends round-trip
    expect(bundle.environment_backends).toBeDefined();
    expect(bundle.environment_backends!.prod.config.dynamodb_table).toBe('terraform-locks');
  });

  test('graph validation passes on full bundle', () => {
    const raw = loadFixture('full_bundle_with_terraform.json') as ModuleBundle;
    const { workspace } = fromBundle(raw);
    const errors = validateWorkspace(workspace);
    expect(errors).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Integration: build iam-stack from scratch with Terraform config actions
// ══════════════════════════════════════════════════════════════════════

describe('Integration: Terraform config actions on iam-stack workspace', () => {
  test('full Terraform configuration flow', () => {
    // Leaf module defs that instances reference
    const leafModules: Record<string, ModuleDef> = {
      'aws-iam-role@v2.0.0': {
        schema_version: '1.0',
        kind: 'module_def',
        id: 'aws-iam-role',
        version: 'v2.0.0',
        interface: { inputs: [], outputs: [] },
        impl: {
          kind: 'leaf',
          source: { kind: 'git', repo: 'example/terraform-aws-iam-role.git', ref: 'v2.0.0' },
        },
      },
      'aws-iam-policy@v1.0.0': {
        schema_version: '1.0',
        kind: 'module_def',
        id: 'aws-iam-policy',
        version: 'v1.0.0',
        interface: { inputs: [], outputs: [] },
        impl: {
          kind: 'leaf',
          source: { kind: 'git', repo: 'example/terraform-aws-iam-policy.git', ref: 'v1.0.0' },
        },
      },
      'aws-iam-role-policy-attachment@v1.0.0': {
        schema_version: '1.0',
        kind: 'module_def',
        id: 'aws-iam-role-policy-attachment',
        version: 'v1.0.0',
        interface: { inputs: [], outputs: [] },
        impl: {
          kind: 'leaf',
          source: {
            kind: 'git',
            repo: 'example/terraform-aws-iam-role-policy-attachment.git',
            ref: 'v1.0.0',
          },
        },
      },
    };

    // Start with a workspace that has instances
    let state = makeWorkspace(
      [
        {
          kind: 'module',
          id: 'iam_role',
          use: { module_id: 'aws-iam-role', version: 'v2.0.0' },
          inputs: {},
        },
        {
          kind: 'module',
          id: 'iam_policy',
          use: { module_id: 'aws-iam-policy', version: 'v1.0.0' },
          inputs: {},
        },
        {
          kind: 'module',
          id: 'iam_policy_attachment',
          use: { module_id: 'aws-iam-role-policy-attachment', version: 'v1.0.0' },
          inputs: {
            role_name: { out: { module: 'iam_role', name: 'role_name' } },
            policy_arn: { out: { module: 'iam_policy', name: 'arn' } },
          },
        },
      ],
      leafModules,
    );

    // 1. Set terraform config
    state = workspaceReducer(state, {
      type: 'SET_TERRAFORM',
      module_key: 'root@v1.0.0',
      terraform: {
        required_version: '>= 1.5',
        required_providers: {
          aws: { source: 'hashicorp/aws', version: '~> 5.0' },
        },
        backend: {
          type: 's3',
          config: {
            bucket: 'my-terraform-state',
            key: 'iam-stack/terraform.tfstate',
            region: 'us-east-1',
            encrypt: true,
          },
        },
      },
    });
    expect(state.modules['root@v1.0.0'].terraform!.required_version).toBe('>= 1.5');

    // 2. Set providers
    state = workspaceReducer(state, {
      type: 'SET_PROVIDERS',
      module_key: 'root@v1.0.0',
      providers: [
        { name: 'aws', config: { region: 'us-east-1' } },
        { name: 'aws', alias: 'west', config: { region: 'us-west-2' } },
      ],
    });
    expect(state.modules['root@v1.0.0'].providers).toHaveLength(2);

    // 3. Set locals
    state = workspaceReducer(state, {
      type: 'SET_LOCALS',
      module_key: 'root@v1.0.0',
      locals: [
        { name: 'common_tags', value: { lit: { ManagedBy: 'lace', Stack: 'iam-stack' } } },
        {
          name: 'full_role_name',
          value: { expr: { lang: 'hcl', value: '"${var.environment}-${var.role_name}"' } },
        },
      ],
    });
    expect(getGraph(state, 'root@v1.0.0').locals).toHaveLength(2);

    // 4. Set depends_on
    state = workspaceReducer(state, {
      type: 'SET_DEPENDS_ON',
      module_key: 'root@v1.0.0',
      instance_id: 'iam_policy_attachment',
      depends_on: ['module.iam_role', 'module.iam_policy'],
    });
    expect(getInst(state, 'iam_policy_attachment').depends_on).toEqual([
      'module.iam_role',
      'module.iam_policy',
    ]);

    // 5. Set environments
    state = workspaceReducer(state, {
      type: 'SET_ENVIRONMENTS',
      environments: {
        dev: { role_name: 'dev-lambda-role', environment: 'dev', max_session_duration: 3600 },
        prod: { role_name: 'prod-lambda-role', environment: 'prod', max_session_duration: 7200 },
      },
    });
    expect(state.environments!.dev.role_name).toBe('dev-lambda-role');

    // 6. Set environment backends
    state = workspaceReducer(state, {
      type: 'SET_ENVIRONMENT_BACKENDS',
      backends: {
        dev: {
          type: 's3',
          config: {
            bucket: 'my-state-dev',
            key: 'iam-stack/terraform.tfstate',
            region: 'us-east-1',
            encrypt: true,
          },
        },
        prod: {
          type: 's3',
          config: {
            bucket: 'my-state-prod',
            key: 'iam-stack/terraform.tfstate',
            region: 'us-east-1',
            encrypt: true,
            dynamodb_table: 'terraform-locks',
          },
        },
      },
    });
    expect(state.environment_backends!.prod.config.dynamodb_table).toBe('terraform-locks');

    // 7. toBundle preserves everything
    const bundle = toBundle(state);
    expect(bundle.modules['root@v1.0.0'].terraform).toBeDefined();
    expect(bundle.modules['root@v1.0.0'].providers).toHaveLength(2);
    expect(bundle.environments).toBeDefined();
    expect(bundle.environment_backends).toBeDefined();
    if (bundle.modules['root@v1.0.0'].impl.kind === 'composite') {
      expect(bundle.modules['root@v1.0.0'].impl.graph.locals).toHaveLength(2);
      // depends_on preserved
      const attachment = bundle.modules['root@v1.0.0'].impl.graph.instances.find(
        (i) => i.id === 'iam_policy_attachment',
      );
      expect(attachment!.depends_on).toEqual(['module.iam_role', 'module.iam_policy']);
      // Wires derived
      expect(bundle.modules['root@v1.0.0'].impl.graph.wires!.length).toBe(2);
    }

    // 8. Graph validation passes
    const errors = validateWorkspace(state);
    expect(errors).toHaveLength(0);
  });
});
