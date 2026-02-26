import { test, expect, describe, beforeEach, vi } from 'vitest';
import type { WorkspaceState } from '../types/workspace';
import type { WorkspaceAction } from '../state/reducer';
import { getToolHandler } from '../../chat/tool-registry';
import { registerGraphWriteTools, type GraphWriteDeps } from '../../chat/tools/graph-write-tools';
import { registerGraphReadTools } from '../../chat/tools/graph-read-tools';
import { registerGenerateTools, type GenerateToolDeps } from '../../chat/tools/generate-tools';
import { makeWorkspace, makeEmptyWorkspace, vpcDef, subnetDef } from './helpers';

// ── Pre-built workspace variants ──

const vpcSubnetModules = { 'aws/vpc@v1.0.0': vpcDef, 'aws/subnet@v1.0.0': subnetDef };

function makeWorkspaceWithInstances(): WorkspaceState {
  return makeWorkspace(
    [
      {
        kind: 'module',
        id: 'vpc',
        use: { module_id: 'aws/vpc', version: 'v1.0.0' },
        inputs: { cidr_block: { lit: '10.0.0.0/16' } },
      },
      {
        kind: 'module',
        id: 'subnet',
        use: { module_id: 'aws/subnet', version: 'v1.0.0' },
        inputs: {
          vpc_id: { out: { module: 'vpc', name: 'vpc_id' } },
          cidr_block: { lit: '10.0.1.0/24' },
        },
      },
    ],
    vpcSubnetModules,
  );
}

function makeWorkspaceWithUnboundSubnet(): WorkspaceState {
  return makeWorkspace(
    [
      {
        kind: 'module',
        id: 'vpc',
        use: { module_id: 'aws/vpc', version: 'v1.0.0' },
        inputs: { cidr_block: { lit: '10.0.0.0/16' } },
      },
      {
        kind: 'module',
        id: 'subnet',
        use: { module_id: 'aws/subnet', version: 'v1.0.0' },
        inputs: { cidr_block: { lit: '10.0.1.0/24' } },
      },
    ],
    vpcSubnetModules,
  );
}

function makeWorkspaceWithDanglingRef(): WorkspaceState {
  return makeWorkspace(
    [
      {
        kind: 'module',
        id: 'subnet',
        use: { module_id: 'aws/subnet', version: 'v1.0.0' },
        inputs: {
          vpc_id: { out: { module: 'ghost', name: 'vpc_id' } },
          cidr_block: { lit: '10.0.1.0/24' },
        },
      },
    ],
    { 'aws/subnet@v1.0.0': subnetDef },
  );
}

// ── Test setup ──

let mockState: WorkspaceState;
let dispatched: WorkspaceAction[];

function makeDeps(): GraphWriteDeps {
  dispatched = [];
  return {
    getRpcClient: () => null,
    getRegistryModules: () => [],
    addModuleToActiveCanvas: vi.fn(),
    requestGraphState: async () => mockState,
    dispatchToCanvas: async (action) => {
      dispatched.push(action);
    },
  };
}

describe('write tools', () => {
  beforeEach(() => {
    mockState = makeWorkspaceWithInstances();
    const deps = makeDeps();
    registerGraphWriteTools(deps);
    registerGraphReadTools({ requestGraphState: async () => mockState });
  });

  describe('lace_remove_module', () => {
    test('removes existing instance', async () => {
      const handler = getToolHandler('lace_remove_module')!;
      const result = await handler({ instance_id: 'vpc' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Removed instance "vpc"');
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({
        type: 'DELETE_INSTANCE',
        instance_id: 'vpc',
      });
    });

    test('returns error for missing instance', async () => {
      const handler = getToolHandler('lace_remove_module')!;
      const result = await handler({ instance_id: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
      expect(result.content).toContain('vpc');
      expect(dispatched).toHaveLength(0);
    });

    test('returns error for missing parameter', async () => {
      const handler = getToolHandler('lace_remove_module')!;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required parameter');
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
      expect(dispatched[0]).toMatchObject({
        type: 'CONNECT',
        source_instance: 'vpc',
        target_instance: 'subnet',
        mapping: { from: 'vpc_id', to: 'vpc_id' },
      });
    });

    test('returns error for missing source instance', async () => {
      const handler = getToolHandler('lace_connect')!;
      const result = await handler({
        source_instance: 'nonexistent',
        target_instance: 'subnet',
        source_output: 'vpc_id',
        target_input: 'vpc_id',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Source instance "nonexistent" not found');
    });

    test('returns error for missing parameters', async () => {
      const handler = getToolHandler('lace_connect')!;
      const result = await handler({ source_instance: 'vpc' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required parameters');
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
      expect(dispatched[0]).toMatchObject({
        type: 'DISCONNECT',
        target_instance: 'subnet',
        input_name: 'vpc_id',
      });
    });

    test('returns error for nonexistent instance', async () => {
      const handler = getToolHandler('lace_disconnect')!;
      const result = await handler({
        target_instance: 'nonexistent',
        input_name: 'vpc_id',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
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
      expect(dispatched[0]).toMatchObject({
        type: 'UPDATE_INPUTS',
        instance_id: 'vpc',
      });
      const action = dispatched[0] as Extract<WorkspaceAction, { type: 'UPDATE_INPUTS' }>;
      expect(action.inputs.enable_dns).toEqual({ lit: true });
      // Existing inputs are preserved (merged)
      expect(action.inputs.cidr_block).toEqual({ lit: '10.0.0.0/16' });
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
      const action = dispatched[0] as Extract<WorkspaceAction, { type: 'UPDATE_INPUTS' }>;
      expect(action.inputs.cidr_block).toEqual({ var: 'vpc_cidr' });
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
      const action = dispatched[0] as Extract<WorkspaceAction, { type: 'UPDATE_INPUTS' }>;
      expect(action.inputs.cidr_block).toEqual({
        expr: {
          lang: 'hcl',
          value: 'var.env == "prod" ? "10.0.0.0/16" : "10.1.0.0/16"',
        },
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
      expect(dispatched).toHaveLength(0);
    });

    test('rejects all three binding types at once', async () => {
      const handler = getToolHandler('lace_set_input')!;
      const result = await handler({
        instance_id: 'vpc',
        input_name: 'cidr_block',
        value: '10.0.0.0/16',
        variable: 'vpc_cidr',
        expression: 'var.cidr',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Must provide exactly one of');
      expect(dispatched).toHaveLength(0);
    });

    test('returns error for nonexistent instance', async () => {
      const handler = getToolHandler('lace_set_input')!;
      const result = await handler({
        instance_id: 'nonexistent',
        input_name: 'cidr_block',
        value: '10.0.0.0/16',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });
  });

  describe('lace_rename_instance', () => {
    test('renames an instance', async () => {
      const handler = getToolHandler('lace_rename_instance')!;
      const result = await handler({ old_id: 'vpc', new_id: 'main_vpc' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Renamed instance "vpc" to "main_vpc"');
      expect(dispatched[0]).toMatchObject({
        type: 'RENAME_INSTANCE',
        old_id: 'vpc',
        new_id: 'main_vpc',
      });
    });

    test('rejects invalid Terraform identifier', async () => {
      const handler = getToolHandler('lace_rename_instance')!;
      const result = await handler({ old_id: 'vpc', new_id: '123invalid' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not a valid Terraform identifier');
    });

    test('rejects rename to existing instance ID', async () => {
      const handler = getToolHandler('lace_rename_instance')!;
      const result = await handler({ old_id: 'vpc', new_id: 'subnet' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('already exists');
    });

    test('rejects nonexistent source instance', async () => {
      const handler = getToolHandler('lace_rename_instance')!;
      const result = await handler({ old_id: 'nonexistent', new_id: 'new_name' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });
  });

  describe('lace_describe_graph', () => {
    test('describes populated graph', async () => {
      const handler = getToolHandler('lace_describe_graph')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('vpc');
      expect(result.content).toContain('subnet');
      expect(result.content).toContain('2 instance(s)');
    });

    test('describes empty graph', async () => {
      mockState = makeEmptyWorkspace();
      const handler = getToolHandler('lace_describe_graph')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('empty');
    });
  });

  describe('lace_validate_graph', () => {
    test('passes valid graph', async () => {
      const handler = getToolHandler('lace_validate_graph')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Validation passed');
    });

    test('reports dangling reference errors', async () => {
      mockState = makeWorkspaceWithDanglingRef();
      const handler = getToolHandler('lace_validate_graph')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('error(s) found');
      expect(result.content).toContain('ghost');
    });

    test('passes empty graph', async () => {
      mockState = makeEmptyWorkspace();
      const handler = getToolHandler('lace_validate_graph')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Validation passed');
    });
  });
});

describe('generate tools', () => {
  let triggerGenerate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockState = makeWorkspaceWithInstances();
    dispatched = [];
    triggerGenerate = vi.fn();
    const deps: GenerateToolDeps = {
      requestGraphState: async () => mockState,
      dispatchToCanvas: async (action) => {
        dispatched.push(action);
      },
      triggerGenerate,
    };
    registerGenerateTools(deps);
  });

  describe('lace_auto_connect', () => {
    test('auto-connects matching outputs to unbound inputs', async () => {
      mockState = makeWorkspaceWithUnboundSubnet();
      const handler = getToolHandler('lace_auto_connect')!;
      const result = await handler({
        source_instance: 'vpc',
        target_instance: 'subnet',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Auto-connected 1 wire(s)');
      expect(result.content).toContain('vpc.vpc_id');
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({
        type: 'CONNECT',
        source_instance: 'vpc',
        target_instance: 'subnet',
        mapping: { from: 'vpc_id', to: 'vpc_id' },
      });
    });

    test('skips inputs that already have any binding', async () => {
      // subnet has both vpc_id (out binding) and cidr_block (lit binding)
      mockState = makeWorkspaceWithInstances();
      const handler = getToolHandler('lace_auto_connect')!;
      const result = await handler({
        source_instance: 'vpc',
        target_instance: 'subnet',
      });

      // Both inputs are bound, so no auto-connections should be made
      expect(result.content).toContain('No compatible connections found');
      expect(dispatched).toHaveLength(0);
    });

    test('returns error for missing parameters', async () => {
      const handler = getToolHandler('lace_auto_connect')!;
      const result = await handler({ source_instance: 'vpc' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Missing required parameters');
    });

    test('returns error for nonexistent source', async () => {
      const handler = getToolHandler('lace_auto_connect')!;
      const result = await handler({
        source_instance: 'nonexistent',
        target_instance: 'subnet',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Source instance "nonexistent" not found');
    });

    test('returns error for nonexistent target', async () => {
      const handler = getToolHandler('lace_auto_connect')!;
      const result = await handler({
        source_instance: 'vpc',
        target_instance: 'nonexistent',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Target instance "nonexistent" not found');
    });

    test('returns no-match message on empty canvas', async () => {
      mockState = makeEmptyWorkspace();
      const handler = getToolHandler('lace_auto_connect')!;
      const result = await handler({
        source_instance: 'vpc',
        target_instance: 'subnet',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });
  });

  describe('lace_generate', () => {
    test('triggers generation', async () => {
      const handler = getToolHandler('lace_generate')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Terraform generation triggered');
      expect(triggerGenerate).toHaveBeenCalledOnce();
    });

    test('reports error when trigger throws', async () => {
      triggerGenerate.mockImplementation(() => {
        throw new Error('No canvas open');
      });
      // Re-register with the throwing mock
      registerGenerateTools({
        requestGraphState: async () => mockState,
        dispatchToCanvas: async (action) => {
          dispatched.push(action);
        },
        triggerGenerate,
      });

      const handler = getToolHandler('lace_generate')!;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('No canvas open');
    });
  });
});
