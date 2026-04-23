import { createToolRegistry, type ToolRegistry } from '@lace-cloud/chat-core';
import type { LaceTransport, RegistryModule, RenderError } from '@lace-cloud/host';
import type { CanvasView } from '@lace-cloud/proto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { type GenerateToolDeps, registerGenerateTools } from '../host/tools/generate-tools';
import { registerGraphReadTools } from '../host/tools/graph-read-tools';
import { type GraphWriteDeps, registerGraphWriteTools } from '../host/tools/graph-write-tools';
import { makeCanvasView, makeEdge, makeNode } from './helpers';

// ── Mock RPC client (post-P10: single applyAction surface + read queries) ──

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    applyAction: vi.fn().mockResolvedValue({ success: true, errors: [] }),
    inspectModule: vi.fn().mockResolvedValue({
      name: 'aws/vpc',
      system: 'aws',
      version: 'v1.0.0',
      module_interface: { inputs: [], outputs: [] },
    }),
    queryNodeConfig: vi.fn().mockResolvedValue({
      instance_id: 'vpc',
      inputs: [],
      outputs: [],
      sibling_ids: [],
      depends_on: [],
      available_variables: [],
    }),
    queryValidate: vi.fn().mockResolvedValue({ errors: [] as RenderError[] }),
    querySettings: vi.fn().mockResolvedValue({
      terraform: { required_version: '', required_providers: [] },
      providers: [],
      locals: [],
      environments: {},
    }),
    sessionGenerate: vi.fn().mockResolvedValue({
      files_written: ['main.tf'],
      diagnostics: [],
    }),
    ...overrides,
  };
}

/**
 * Next-view stub for tests: tools that call `applyActionAndAwaitView`
 * receive this view after the applyAction mock resolves. Tests that
 * need to inspect the post-mutation view override this per-assertion.
 */
function makeAwaitNextView(view: CanvasView | null) {
  return () => Promise.resolve(view);
}

// ── Registry module fixtures ──

const testModules: RegistryModule[] = [
  {
    id: 'aws/vpc',
    name: 'aws/vpc',
    version: 'v1.0.0',
    system: 'aws',
    description: 'AWS VPC',
    categories: ['networking'],
  },
  {
    id: 'aws/subnet',
    name: 'aws/subnet',
    version: 'v1.0.0',
    system: 'aws',
    description: 'AWS Subnet',
    categories: ['networking'],
  },
  {
    id: 'azure/resource-group',
    name: 'azure/resource-group',
    version: 'v2.0.0',
    system: 'azure',
    description: 'Azure RG',
    categories: ['core'],
  },
];

// ── Test setup ──

let mockClient: ReturnType<typeof makeMockClient>;
let registry: ToolRegistry;

function makeWriteDeps(
  nextView: CanvasView | null = makeCanvasView([makeNode('vpc', 'module', 'aws/vpc@v1.0.0')]),
): GraphWriteDeps {
  mockClient = makeMockClient();
  return {
    getRpcClient: () => mockClient as unknown as LaceTransport,
    getRegistryModules: () => testModules,
    getUserOrgs: () => [],
    getCanvasView: () => null,
    awaitNextView: makeAwaitNextView(nextView),
  };
}

describe('write tools', () => {
  beforeEach(() => {
    registry = createToolRegistry();
    const deps = makeWriteDeps();
    registerGraphWriteTools(registry, deps);
    registerGraphReadTools(registry, {
      getRpcClient: () => mockClient as unknown as LaceTransport,
      getCanvasView: () => null,
    });
  });

  describe('lace_add_module', () => {
    test('adds module by exact name via applyAction RPC', async () => {
      const handler = registry.getHandler('lace_add_module')!;
      const result = await handler({ name: 'aws/vpc' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('aws/vpc');
      expect(result.content).toContain('instance **"vpc"**');
      expect(mockClient.applyAction).toHaveBeenCalledWith([
        {
          place_module: expect.objectContaining({
            name: 'aws/vpc',
            system: 'aws',
            version: 'v1.0.0',
          }),
        },
      ]);
    });

    test('resolves single fuzzy match', async () => {
      const handler = registry.getHandler('lace_add_module')!;
      const result = await handler({ name: 'resource-group' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('azure/resource-group');
      expect(mockClient.applyAction).toHaveBeenCalledWith([
        {
          place_module: expect.objectContaining({
            name: 'azure/resource-group',
            system: 'azure',
            version: 'v2.0.0',
          }),
        },
      ]);
    });

    test('disambiguates multiple fuzzy matches', async () => {
      const handler = registry.getHandler('lace_add_module')!;
      const result = await handler({ name: 'aws' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Multiple modules match');
      expect(result.content).toContain('aws/vpc');
      expect(result.content).toContain('aws/subnet');
      expect(mockClient.applyAction).not.toHaveBeenCalled();
    });

    test('passes org provenance when module found in user org', async () => {
      mockClient = makeMockClient({
        listRegistryModules: vi
          .fn()
          .mockResolvedValueOnce({ modules: [] })
          .mockResolvedValueOnce({
            modules: [
              {
                id: 'aws/custom-networking',
                name: 'aws/custom-networking',
                version: 'v1.0.0',
                system: 'aws',
              },
            ],
          }),
      });

      const deps: GraphWriteDeps = {
        getRpcClient: () => mockClient as unknown as LaceTransport,
        getRegistryModules: () => [],
        getUserOrgs: () => [{ slug: 'acme-corp', name: 'Acme Corp', role: 'member' }],
        getCanvasView: () => null,
        awaitNextView: makeAwaitNextView(
          makeCanvasView([makeNode('custom-networking', 'module', 'aws/custom-networking@v1.0.0')]),
        ),
      };
      registry = createToolRegistry();
      registerGraphWriteTools(registry, deps);
      registerGraphReadTools(registry, {
        getRpcClient: () => mockClient as unknown as LaceTransport,
        getCanvasView: () => null,
      });

      const handler = registry.getHandler('lace_add_module')!;
      const result = await handler({ name: 'aws/custom-networking' });

      expect(result.isError).toBeFalsy();
      expect(mockClient.applyAction).toHaveBeenCalledWith([
        { place_module: expect.objectContaining({ organization: 'acme-corp' }) },
      ]);
    });

    test('surfaces engine error when applyAction rejects', async () => {
      mockClient.applyAction.mockResolvedValue({
        success: false,
        errors: [{ instance_id: '', input_name: '', message: 'module not found in registry' }],
      });
      const handler = registry.getHandler('lace_add_module')!;
      const result = await handler({ name: 'aws/vpc' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('module not found in registry');
    });
  });

  describe('lace_set_input', () => {
    test('sets literal value', async () => {
      const handler = registry.getHandler('lace_set_input')!;
      const result = await handler({
        instance_id: 'vpc',
        input_name: 'enable_dns',
        value: true,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('literal true');
      expect(mockClient.applyAction).toHaveBeenCalledWith([
        {
          update_input: expect.objectContaining({
            instance_id: 'vpc',
            input_name: 'enable_dns',
            value: true,
          }),
        },
      ]);
    });

    test('sets variable reference', async () => {
      const handler = registry.getHandler('lace_set_input')!;
      const result = await handler({
        instance_id: 'vpc',
        input_name: 'cidr_block',
        variable: 'vpc_cidr',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('variable "vpc_cidr"');
      expect(mockClient.applyAction).toHaveBeenCalledWith([
        {
          update_input: expect.objectContaining({
            instance_id: 'vpc',
            input_name: 'cidr_block',
            variable: 'vpc_cidr',
          }),
        },
      ]);
    });

    test('returns error when no binding type provided', async () => {
      const handler = registry.getHandler('lace_set_input')!;
      const result = await handler({
        instance_id: 'vpc',
        input_name: 'cidr_block',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Must provide exactly one of');
    });
  });

  describe('lace_validate_graph', () => {
    test('reports errors from CLI', async () => {
      mockClient.queryValidate.mockResolvedValue({
        errors: [
          { instance_id: 'subnet', input_name: 'vpc_id', message: 'Dangling reference to "ghost"' },
        ],
      });
      const handler = registry.getHandler('lace_validate_graph')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('1 error(s) found');
      expect(result.content).toContain('ghost');
    });
  });
});

describe('generate tools', () => {
  beforeEach(() => {
    mockClient = makeMockClient();
    registry = createToolRegistry();
    const deps: GenerateToolDeps = {
      getRpcClient: () => mockClient as unknown as LaceTransport,
      getLaceDir: () => '/tmp/test-workspace/.lace',
      getCanvasView: () => null,
      awaitNextView: makeAwaitNextView(
        makeCanvasView(
          [makeNode('vpc'), makeNode('subnet')],
          [makeEdge('vpc', 'subnet', 'vpc_id', 'vpc_id')],
        ),
      ),
    };
    registerGenerateTools(registry, deps);
  });

  describe('lace_auto_connect', () => {
    test('auto-connects matching outputs to unbound inputs', async () => {
      const handler = registry.getHandler('lace_auto_connect')!;
      const result = await handler({
        source_instance: 'vpc',
        target_instance: 'subnet',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Auto-connected 1 wire(s)');
      expect(result.content).toContain('vpc.vpc_id');
      expect(mockClient.applyAction).toHaveBeenCalledWith([
        { auto_connect: { source: 'vpc', target: 'subnet' } },
      ]);
    });

    test('reports no match when no edges returned', async () => {
      mockClient = makeMockClient();
      registry = createToolRegistry();
      const deps: GenerateToolDeps = {
        getRpcClient: () => mockClient as unknown as LaceTransport,
        getLaceDir: () => '/tmp/test-workspace/.lace',
        getCanvasView: () => null,
        awaitNextView: makeAwaitNextView(makeCanvasView([makeNode('vpc'), makeNode('subnet')])),
      };
      registerGenerateTools(registry, deps);
      const handler = registry.getHandler('lace_auto_connect')!;
      const result = await handler({
        source_instance: 'vpc',
        target_instance: 'subnet',
      });

      expect(result.content).toContain('No compatible connections found');
    });
  });

  describe('lace_generate', () => {
    test('generates terraform via RPC', async () => {
      const handler = registry.getHandler('lace_generate')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Terraform generated successfully');
      expect(result.content).toContain('Files written to');
      expect(mockClient.sessionGenerate).toHaveBeenCalledWith({
        output_dir: '/tmp/test-workspace/.lace',
        options: {
          dry_run: false,
          format: true,
          validate: true,
          overwrite: true,
        },
      });
    });

    test('reports errors from CLI', async () => {
      mockClient.sessionGenerate.mockResolvedValue({
        diagnostics: [{ severity: 'error', message: 'Missing required input' }],
      });
      const handler = registry.getHandler('lace_generate')!;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Generation failed');
      expect(result.content).toContain('Missing required input');
    });

    test('returns error when no workspace folder', async () => {
      const deps: GenerateToolDeps = {
        getRpcClient: () => mockClient as unknown as LaceTransport,
        getLaceDir: () => undefined,
        getCanvasView: () => null,
        awaitNextView: makeAwaitNextView(null),
      };
      registry = createToolRegistry();
      registerGenerateTools(registry, deps);

      const handler = registry.getHandler('lace_generate')!;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('No workspace folder');
    });
  });
});

describe('settings tools', () => {
  beforeEach(() => {
    registry = createToolRegistry();
    const deps = makeWriteDeps();
    registerGraphWriteTools(registry, deps);
  });

  describe('lace_set_local', () => {
    test('sets literal local value', async () => {
      const handler = registry.getHandler('lace_set_local')!;
      const result = await handler({ name: 'region', value: 'us-east-1' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('region');
      expect(result.content).toContain('us-east-1');
      expect(mockClient.querySettings).toHaveBeenCalled();
      expect(mockClient.applyAction).toHaveBeenCalledWith([
        {
          set_locals: {
            locals: [
              expect.objectContaining({
                name: 'region',
                mode: 'literal',
                value: 'us-east-1',
              }),
            ],
          },
        },
      ]);
    });

    test('sets expression local', async () => {
      const handler = registry.getHandler('lace_set_local')!;
      const result = await handler({ name: 'prefix', expression: 'var.project' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('expression');
      expect(mockClient.applyAction).toHaveBeenCalledWith([
        {
          set_locals: {
            locals: [
              expect.objectContaining({
                name: 'prefix',
                mode: 'expression',
                expression: 'var.project',
              }),
            ],
          },
        },
      ]);
    });

    test('returns error when neither value nor expression provided', async () => {
      const handler = registry.getHandler('lace_set_local')!;
      const result = await handler({ name: 'region' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Must provide exactly one of');
    });
  });

  describe('lace_set_environment', () => {
    test('sets environment variables', async () => {
      const handler = registry.getHandler('lace_set_environment')!;
      const result = await handler({
        environment: 'staging',
        variables: { region: 'us-west-2', instance_type: 't3.small' },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('staging');
      expect(result.content).toContain('region');
      expect(mockClient.querySettings).toHaveBeenCalled();
      expect(mockClient.applyAction).toHaveBeenCalledWith([
        {
          set_environments: expect.objectContaining({
            environments: { staging: { region: 'us-west-2', instance_type: 't3.small' } },
          }),
        },
      ]);
    });

    test('returns error when environment name missing', async () => {
      const handler = registry.getHandler('lace_set_environment')!;
      const result = await handler({ variables: { region: 'us-east-1' } });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required parameter: environment');
    });
  });
});
