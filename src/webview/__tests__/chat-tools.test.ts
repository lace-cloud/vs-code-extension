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
    dropBundle: vi
      .fn()
      .mockResolvedValue(makeCanvasView([makeNode('vpc', 'module', 'aws/vpc@v1.0.0')])),
    updateInput: vi.fn().mockResolvedValue(makeCanvasView([makeNode('vpc')])),
    autoConnect: vi
      .fn()
      .mockResolvedValue(
        makeCanvasView(
          [makeNode('vpc'), makeNode('subnet')],
          [makeEdge('vpc', 'subnet', 'vpc_id', 'vpc_id')],
        ),
      ),
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
      mockClient as unknown as import('../../utilities/engine/grpc-client').LaceClient,
    getRegistryModules: () => testModules,
  };
}

describe('write tools', () => {
  beforeEach(() => {
    const deps = makeWriteDeps();
    registerGraphWriteTools(deps);
    registerGraphReadTools({
      getRpcClient: () =>
        mockClient as unknown as import('../../utilities/engine/grpc-client').LaceClient,
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
      expect(mockClient.dropBundle).toHaveBeenCalledWith({
        deploy_bundle: { entry: 'vpc@v1.0.0', modules: {} },
        position: { x: 100, y: 100 },
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

    test('returns error when deploy bundle is null', async () => {
      mockClient.getRegistryVersion.mockResolvedValue({ deploy_bundle: null });
      const handler = getToolHandler('lace_add_module')!;
      const result = await handler({ name: 'aws/vpc' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('no deploy bundle');
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
      expect(mockClient.updateInput).toHaveBeenCalledWith({
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
      expect(mockClient.updateInput).toHaveBeenCalledWith({
        instance_id: 'vpc',
        input_name: 'cidr_block',
        mode: 'variable',
        value: undefined,
        variable: 'vpc_cidr',
        expression: undefined,
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
  });

  describe('lace_validate_graph', () => {
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
        mockClient as unknown as import('../../utilities/engine/grpc-client').LaceClient,
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
      expect(mockClient.autoConnect).toHaveBeenCalledWith({
        source: 'vpc',
        target: 'subnet',
      });
    });

    test('reports no match when no edges returned', async () => {
      mockClient.autoConnect.mockResolvedValue(
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

    test('returns error when no workspace folder', async () => {
      const deps: GenerateToolDeps = {
        getRpcClient: () =>
          mockClient as unknown as import('../../utilities/engine/grpc-client').LaceClient,
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
