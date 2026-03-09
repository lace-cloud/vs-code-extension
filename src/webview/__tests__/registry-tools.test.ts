import { test, expect, describe, beforeEach, vi } from 'vitest';
import type { RegistryModule } from '../../types/protocol';
import { getToolHandler } from '../../chat/tool-registry';
import { registerRegistryTools, type RegistryToolDeps } from '../../chat/tools/registry-tools';

// ── Mock registry modules ──

const awsVpc: RegistryModule = {
  id: 'aws/vpc',
  name: 'aws/vpc',
  version: 'v1.0.0',
  system: 'aws',
  description: 'Create an AWS VPC with configurable CIDR',
  categories: ['networking'],
  icon_url: 'https://example.com/vpc.svg',
};

const awsSubnet: RegistryModule = {
  id: 'aws/subnet',
  name: 'aws/subnet',
  version: 'v1.0.0',
  system: 'aws',
  description: 'Create subnets within a VPC',
  categories: ['networking'],
};

const azureRg: RegistryModule = {
  id: 'azure/resource-group',
  name: 'azure/resource-group',
  version: 'v2.0.0',
  system: 'azure',
  description: 'Azure resource group',
  categories: ['core'],
};

const allModules = [awsVpc, awsSubnet, azureRg];

// ── Test setup ──

function makeDeps(modules: RegistryModule[] = allModules): RegistryToolDeps {
  return {
    getRpcClient: () => null, // No RPC — use local fallback
    getRegistryModules: () => modules,
  };
}

describe('lace_search_registry', () => {
  beforeEach(() => {
    registerRegistryTools(makeDeps());
  });

  test('finds modules by keyword', async () => {
    const handler = getToolHandler('lace_search_registry')!;
    const result = await handler({ query: 'vpc' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('aws/vpc');
    expect(result.content).toContain('aws/subnet'); // "VPC" in description
  });

  test('filters by system', async () => {
    const handler = getToolHandler('lace_search_registry')!;
    const result = await handler({ system: 'azure' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('azure/resource-group');
    expect(result.content).not.toContain('aws/vpc');
  });
});

describe('lace_inspect_module', () => {
  beforeEach(() => {
    registerRegistryTools(makeDeps());
  });

  test('returns basic info when RPC unavailable', async () => {
    const handler = getToolHandler('lace_inspect_module')!;
    const result = await handler({ name: 'aws/vpc' });

    // No RPC client, so falls back to local cache info
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('aws/vpc');
    expect(result.content).toContain('aws');
    expect(result.content).toContain('v1.0.0');
    expect(result.content).toContain('cannot fetch full interface schema');
  });

  test('disambiguates multiple fuzzy matches', async () => {
    const handler = getToolHandler('lace_inspect_module')!;
    const result = await handler({ name: 'aws' });

    // "aws" matches both aws/vpc and aws/subnet
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Multiple modules match');
    expect(result.content).toContain('aws/vpc');
    expect(result.content).toContain('aws/subnet');
  });

  test('returns RPC results when client available', async () => {
    const mockClient = {
      getRegistryVersion: vi.fn().mockResolvedValue({
        deploy_bundle: {
          /* opaque */
        },
        module_interface: {
          inputs: [
            {
              name: 'cidr_block',
              type: 'string',
              required: true,
              description: 'CIDR block',
              sensitive: false,
            },
            {
              name: 'enable_dns',
              type: 'bool',
              required: false,
              description: '',
              default_value: true,
              sensitive: false,
            },
          ],
          outputs: [
            {
              name: 'vpc_id',
              type: 'string',
              required: false,
              description: 'The VPC ID',
              sensitive: false,
            },
          ],
        },
      }),
    };

    registerRegistryTools({
      getRpcClient: () => mockClient as any,
      getRegistryModules: () => allModules,
    });

    const handler = getToolHandler('lace_inspect_module')!;
    const result = await handler({ name: 'aws/vpc' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('cidr_block');
    expect(result.content).toContain('**(required)**');
    expect(result.content).toContain('enable_dns');
    expect(result.content).toContain('vpc_id');
    expect(result.content).toContain('The VPC ID');
    expect(result.content).toContain('CIDR block');
  });
});
