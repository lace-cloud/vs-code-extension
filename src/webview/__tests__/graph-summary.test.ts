import { test, expect, describe } from 'vitest';
import { summarizeGraph } from '../../chat/graph-summary';
import { makeWorkspace, vpcDef, subnetDef } from './helpers';

describe('summarizeGraph', () => {
  test('empty canvas', () => {
    const ws = makeWorkspace([]);
    const summary = summarizeGraph(ws);

    expect(summary.instance_count).toBe(0);
    expect(summary.instances).toEqual([]);
    expect(summary.connections).toEqual([]);
  });

  test('single instance with resolved schema', () => {
    const ws = makeWorkspace(
      [
        {
          kind: 'module',
          id: 'vpc',
          use: { module_id: 'aws/vpc', version: 'v1.0.0' },
          inputs: { cidr_block: { lit: '10.0.0.0/16' } },
        },
      ],
      { 'aws/vpc@v1.0.0': vpcDef },
    );
    const summary = summarizeGraph(ws);

    expect(summary.instance_count).toBe(1);
    expect(summary.instances[0].id).toBe('vpc');
    expect(summary.instances[0].module_id).toBe('aws/vpc');
    expect(summary.instances[0].inputs).toEqual({ cidr_block: '"10.0.0.0/16"' });
    expect(summary.instances[0].outputs).toEqual(['vpc_id']);
    expect(summary.instances[0].unbound_required_inputs).toEqual([]);
  });

  test('detects unbound required inputs', () => {
    const ws = makeWorkspace(
      [
        {
          kind: 'module',
          id: 'vpc',
          use: { module_id: 'aws/vpc', version: 'v1.0.0' },
          inputs: {},
        },
      ],
      { 'aws/vpc@v1.0.0': vpcDef },
    );
    const summary = summarizeGraph(ws);

    expect(summary.instances[0].unbound_required_inputs).toEqual(['cidr_block']);
    expect(summary.unbound_required_inputs).toEqual([
      { instance_id: 'vpc', input_name: 'cidr_block', type: 'string' },
    ]);
  });

  test('derives connections from out bindings', () => {
    const ws = makeWorkspace(
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
      { 'aws/vpc@v1.0.0': vpcDef, 'aws/subnet@v1.0.0': subnetDef },
    );
    const summary = summarizeGraph(ws);

    expect(summary.connections).toEqual([
      {
        from_instance: 'vpc',
        from_output: 'vpc_id',
        to_instance: 'subnet',
        to_input: 'vpc_id',
      },
    ]);
  });

  test('describes binding types correctly', () => {
    const ws = makeWorkspace(
      [
        {
          kind: 'module',
          id: 'vpc',
          use: { module_id: 'aws/vpc', version: 'v1.0.0' },
          inputs: {
            cidr_block: { var: 'vpc_cidr' },
            enable_dns: { expr: { lang: 'hcl', value: 'true' } },
          },
        },
      ],
      { 'aws/vpc@v1.0.0': vpcDef },
    );
    const summary = summarizeGraph(ws);

    expect(summary.instances[0].inputs).toEqual({
      cidr_block: 'var.vpc_cidr',
      enable_dns: 'expr: true',
    });
  });

  test('includes variables and exports', () => {
    const ws = makeWorkspace(
      [
        {
          kind: 'module',
          id: 'vpc',
          use: { module_id: 'aws/vpc', version: 'v1.0.0' },
          inputs: { cidr_block: { var: 'vpc_cidr' } },
        },
      ],
      { 'aws/vpc@v1.0.0': vpcDef },
      {},
      { vpc_id: { out: { module: 'vpc', name: 'vpc_id' } } },
      [{ name: 'vpc_cidr', type: 'string', required: true }],
    );
    const summary = summarizeGraph(ws);

    expect(summary.variables).toEqual(['vpc_cidr']);
    expect(summary.exports).toEqual(['vpc_id']);
  });
});
