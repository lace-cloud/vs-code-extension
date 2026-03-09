import { test, expect, describe, beforeEach, vi } from 'vitest';
import { getToolHandler } from '../../chat/tool-registry';
import { registerGraphWriteTools, type GraphWriteDeps } from '../../chat/tools/graph-write-tools';
import { registerGraphReadTools } from '../../chat/tools/graph-read-tools';
import { registerGenerateTools, type GenerateToolDeps } from '../../chat/tools/generate-tools';
import { makeCanvasView, makeNode, makeEdge } from './helpers';
import type { RenderError } from '../types/render';
import type { RegistryModule } from '../../types/protocol';

// ── Mock RPC client ──

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    getRegistryVersion: vi
      .fn()
      .mockResolvedValue({ deploy_bundle: { entry: 'vpc@v1.0.0', modules: {} } }),
    actionDropBundle: vi
      .fn()
      .mockResolvedValue(makeCanvasView([makeNode('vpc', 'module', 'aws/vpc@v1.0.0')])),
    actionDeleteInstance: vi.fn().mockResolvedValue(makeCanvasView()),
    actionConnect: vi
      .fn()
      .mockResolvedValue(
        makeCanvasView(
          [makeNode('vpc'), makeNode('subnet')],
          [makeEdge('vpc', 'subnet', 'vpc_id', 'vpc_id')],
        ),
      ),
    actionDisconnect: vi
      .fn()
      .mockResolvedValue(makeCanvasView([makeNode('vpc'), makeNode('subnet')])),
    actionUpdateInput: vi.fn().mockResolvedValue(makeCanvasView([makeNode('vpc')])),
    actionRenameInstance: vi.fn().mockResolvedValue(makeCanvasView([makeNode('main_vpc')])),
    actionAutoConnect: vi
      .fn()
      .mockResolvedValue(
        makeCanvasView(
          [makeNode('vpc'), makeNode('subnet')],
          [makeEdge('vpc', 'subnet', 'vpc_id', 'vpc_id')],
        ),
      ),
    queryGraphSummary: vi.fn().mockResolvedValue({ text: '**Canvas: root** (2 instance(s))' }),
    queryValidate: vi.fn().mockResolvedValue({ errors: [] as RenderError[] }),
    sessionGenerate: vi.fn().mockResolvedValue({
      files_written: ['main.tf'],
      diagnostics: [],
    }),
    ...overrides,
  };
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

function makeWriteDeps(): GraphWriteDeps {
  mockClient = makeMockClient();
  return {
    getRpcClient: () =>
      mockClient as unknown as import('../../utilities/engine/rpc-client').JSONRPCClient,
    getRegistryModules: () => testModules,
  };
}

describe('write tools', () => {
  beforeEach(() => {
    const deps = makeWriteDeps();
    registerGraphWriteTools(deps);
    registerGraphReadTools({
      getRpcClient: () =>
        mockClient as unknown as import('../../utilities/engine/rpc-client').JSONRPCClient,
    });
  });

  describe('lace_add_module', () => {
    test('adds module by exact name', async () => {
      const handler = getToolHandler('lace_add_module')!;
      const result = await handler({ name: 'aws/vpc' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('aws/vpc');
      expect(result.content).toContain('instance "vpc"');
      expect(mockClient.getRegistryVersion).toHaveBeenCalledWith({
        name: 'aws/vpc',
        system: 'aws',
        version: 'v1.0.0',
      });
      expect(mockClient.actionDropBundle).toHaveBeenCalledWith({
        deploy_bundle: { entry: 'vpc@v1.0.0', modules: {} },
      });
    });

    test('resolves single fuzzy match', async () => {
      const handler = getToolHandler('lace_add_module')!;
      const result = await handler({ name: 'resource-group' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('azure/resource-group');
      expect(mockClient.getRegistryVersion).toHaveBeenCalledWith({
        name: 'azure/resource-group',
        system: 'azure',
        version: 'v2.0.0',
      });
    });

    test('disambiguates multiple fuzzy matches', async () => {
      const handler = getToolHandler('lace_add_module')!;
      const result = await handler({ name: 'aws' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Multiple modules match');
      expect(result.content).toContain('aws/vpc');
      expect(result.content).toContain('aws/subnet');
      expect(mockClient.getRegistryVersion).not.toHaveBeenCalled();
    });

    test('narrows fuzzy match with system filter', async () => {
      const handler = getToolHandler('lace_add_module')!;
      const result = await handler({ name: 'resource', system: 'azure' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('azure/resource-group');
      expect(mockClient.getRegistryVersion).toHaveBeenCalled();
    });

    test('returns not-found for unknown module', async () => {
      const handler = getToolHandler('lace_add_module')!;
      const result = await handler({ name: 'gcp/compute' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found in the registry');
      expect(result.content).toContain('lace_search_registry');
    });

    test('returns error when deploy bundle is null', async () => {
      mockClient.getRegistryVersion.mockResolvedValue({ deploy_bundle: null });
      const handler = getToolHandler('lace_add_module')!;
      const result = await handler({ name: 'aws/vpc' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('no deploy bundle');
    });

    test('returns fallback message when instance ID not in response', async () => {
      mockClient.actionDropBundle.mockResolvedValue(
        makeCanvasView([makeNode('some_other_id', 'module', 'other/thing@v1.0.0')]),
      );
      const handler = getToolHandler('lace_add_module')!;
      const result = await handler({ name: 'aws/vpc' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('lace_describe_graph');
    });
  });

  describe('lace_remove_module', () => {
    test('removes existing instance', async () => {
      const handler = getToolHandler('lace_remove_module')!;
      const result = await handler({ instance_id: 'vpc' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Removed instance "vpc"');
      expect(mockClient.actionDeleteInstance).toHaveBeenCalledWith({ instance_id: 'vpc' });
    });
  });

  describe('lace_connect', () => {
    test('connects output to input', async () => {
      const handler = getToolHandler('lace_connect')!;
      const result = await handler({
        source_instance: 'vpc',
        target_instance: 'subnet',
        source_output: 'vpc_id',
        target_input: 'vpc_id',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Connected vpc.vpc_id → subnet.vpc_id');
      expect(mockClient.actionConnect).toHaveBeenCalledWith({
        source: 'vpc',
        target: 'subnet',
        source_output: 'vpc_id',
        target_input: 'vpc_id',
      });
    });
  });

  describe('lace_disconnect', () => {
    test('disconnects an input', async () => {
      const handler = getToolHandler('lace_disconnect')!;
      const result = await handler({
        target_instance: 'subnet',
        input_name: 'vpc_id',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Disconnected input "vpc_id"');
      expect(mockClient.actionDisconnect).toHaveBeenCalledWith({
        target: 'subnet',
        input_name: 'vpc_id',
      });
    });
  });

  describe('lace_set_input', () => {
    test('sets literal value', async () => {
      const handler = getToolHandler('lace_set_input')!;
      const result = await handler({
        instance_id: 'vpc',
        input_name: 'enable_dns',
        value: true,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('literal true');
      expect(mockClient.actionUpdateInput).toHaveBeenCalledWith({
        instance_id: 'vpc',
        input_name: 'enable_dns',
        mode: 'literal',
        value: true,
        variable: undefined,
        expression: undefined,
      });
    });

    test('sets variable reference', async () => {
      const handler = getToolHandler('lace_set_input')!;
      const result = await handler({
        instance_id: 'vpc',
        input_name: 'cidr_block',
        variable: 'vpc_cidr',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('variable "vpc_cidr"');
      expect(mockClient.actionUpdateInput).toHaveBeenCalledWith({
        instance_id: 'vpc',
        input_name: 'cidr_block',
        mode: 'variable',
        value: undefined,
        variable: 'vpc_cidr',
        expression: undefined,
      });
    });

    test('sets HCL expression', async () => {
      const handler = getToolHandler('lace_set_input')!;
      const result = await handler({
        instance_id: 'vpc',
        input_name: 'cidr_block',
        expression: 'var.env == "prod" ? "10.0.0.0/16" : "10.1.0.0/16"',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('expression');
      expect(mockClient.actionUpdateInput).toHaveBeenCalledWith({
        instance_id: 'vpc',
        input_name: 'cidr_block',
        mode: 'expression',
        value: undefined,
        variable: undefined,
        expression: 'var.env == "prod" ? "10.0.0.0/16" : "10.1.0.0/16"',
      });
    });

    test('returns error when no binding type provided', async () => {
      const handler = getToolHandler('lace_set_input')!;
      const result = await handler({
        instance_id: 'vpc',
        input_name: 'cidr_block',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Must provide exactly one of');
    });

    test('rejects multiple binding types at once', async () => {
      const handler = getToolHandler('lace_set_input')!;
      const result = await handler({
        instance_id: 'vpc',
        input_name: 'cidr_block',
        value: '10.0.0.0/16',
        variable: 'vpc_cidr',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Must provide exactly one of');
    });
  });

  describe('lace_rename_instance', () => {
    test('renames an instance', async () => {
      const handler = getToolHandler('lace_rename_instance')!;
      const result = await handler({ old_id: 'vpc', new_id: 'main_vpc' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Renamed instance "vpc" to "main_vpc"');
      expect(mockClient.actionRenameInstance).toHaveBeenCalledWith({
        old_id: 'vpc',
        new_id: 'main_vpc',
      });
    });
  });

  describe('lace_describe_graph', () => {
    test('returns graph summary from CLI', async () => {
      const handler = getToolHandler('lace_describe_graph')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('2 instance(s)');
      expect(mockClient.queryGraphSummary).toHaveBeenCalled();
    });
  });

  describe('lace_validate_graph', () => {
    test('passes valid graph', async () => {
      const handler = getToolHandler('lace_validate_graph')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Validation passed');
    });

    test('reports errors from CLI', async () => {
      mockClient.queryValidate.mockResolvedValue({
        errors: [
          { instance_id: 'subnet', input_name: 'vpc_id', message: 'Dangling reference to "ghost"' },
        ],
      });
      const handler = getToolHandler('lace_validate_graph')!;
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
    const deps: GenerateToolDeps = {
      getRpcClient: () =>
        mockClient as unknown as import('../../utilities/engine/rpc-client').JSONRPCClient,
      getLaceDir: () => '/tmp/test-workspace/.lace',
    };
    registerGenerateTools(deps);
  });

  describe('lace_auto_connect', () => {
    test('auto-connects matching outputs to unbound inputs', async () => {
      const handler = getToolHandler('lace_auto_connect')!;
      const result = await handler({
        source_instance: 'vpc',
        target_instance: 'subnet',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Auto-connected 1 wire(s)');
      expect(result.content).toContain('vpc.vpc_id');
      expect(mockClient.actionAutoConnect).toHaveBeenCalledWith({
        source: 'vpc',
        target: 'subnet',
      });
    });

    test('reports no match when no edges returned', async () => {
      mockClient.actionAutoConnect.mockResolvedValue(
        makeCanvasView([makeNode('vpc'), makeNode('subnet')]),
      );
      const handler = getToolHandler('lace_auto_connect')!;
      const result = await handler({
        source_instance: 'vpc',
        target_instance: 'subnet',
      });

      expect(result.content).toContain('No compatible connections found');
    });
  });

  describe('lace_generate', () => {
    test('generates terraform via RPC', async () => {
      const handler = getToolHandler('lace_generate')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Terraform generated successfully');
      expect(result.content).toContain('1 file(s) written');
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
      const handler = getToolHandler('lace_generate')!;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Generation failed');
      expect(result.content).toContain('Missing required input');
    });

    test('reports error when RPC fails', async () => {
      mockClient.sessionGenerate.mockRejectedValue(new Error('No canvas open'));
      const handler = getToolHandler('lace_generate')!;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('No canvas open');
    });

    test('returns error when no workspace folder', async () => {
      const deps: GenerateToolDeps = {
        getRpcClient: () =>
          mockClient as unknown as import('../../utilities/engine/rpc-client').JSONRPCClient,
        getLaceDir: () => undefined,
      };
      registerGenerateTools(deps);

      const handler = getToolHandler('lace_generate')!;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('No workspace folder');
    });
  });
});
