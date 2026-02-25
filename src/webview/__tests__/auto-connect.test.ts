import { test, expect, describe } from 'vitest';
import { scoreMatch, findAutoConnections } from '../../chat/auto-connect';
import type { InputDef, OutputDef } from '../types/ir';

describe('scoreMatch', () => {
  test('exact name match scores 100', () => {
    const out: OutputDef = { name: 'vpc_id', type: 'string' };
    const inp: InputDef = { name: 'vpc_id', type: 'string', required: true };
    expect(scoreMatch(out, inp)).toBe(100);
  });

  test('suffix-stripped match scores 90', () => {
    const out: OutputDef = { name: 'subnet_id', type: 'string' };
    const inp: InputDef = { name: 'private_id', type: 'string', required: true };
    expect(scoreMatch(out, inp)).toBe(90);
  });

  test('substring match scores 50', () => {
    const out: OutputDef = { name: 'vpc_id', type: 'string' };
    const inp: InputDef = { name: 'id', type: 'string', required: true };
    expect(scoreMatch(out, inp)).toBe(50);
  });

  test('type-only match scores 30', () => {
    const out: OutputDef = { name: 'arn', type: 'string' };
    const inp: InputDef = { name: 'role_name', type: 'string', required: true };
    expect(scoreMatch(out, inp)).toBe(30);
  });

  test('no match scores 0', () => {
    const out: OutputDef = { name: 'arn', type: 'string' };
    const inp: InputDef = { name: 'count', type: 'number', required: true };
    expect(scoreMatch(out, inp)).toBe(0);
  });
});

describe('findAutoConnections', () => {
  test('finds exact name matches', () => {
    const outputs: OutputDef[] = [
      { name: 'vpc_id', type: 'string' },
      { name: 'cidr_block', type: 'string' },
    ];
    const inputs: InputDef[] = [
      { name: 'vpc_id', type: 'string', required: true },
      { name: 'cidr_block', type: 'string', required: true },
    ];

    const result = findAutoConnections(outputs, inputs, new Set());
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ from: 'vpc_id', to: 'vpc_id', score: 100 });
    expect(result[1]).toMatchObject({ from: 'cidr_block', to: 'cidr_block', score: 100 });
  });

  test('skips already-bound inputs', () => {
    const outputs: OutputDef[] = [{ name: 'vpc_id', type: 'string' }];
    const inputs: InputDef[] = [{ name: 'vpc_id', type: 'string', required: true }];

    const result = findAutoConnections(outputs, inputs, new Set(['vpc_id']));
    expect(result).toHaveLength(0);
  });

  test('skips optional inputs', () => {
    const outputs: OutputDef[] = [{ name: 'tags', type: 'map' }];
    const inputs: InputDef[] = [{ name: 'tags', type: 'map', required: false }];

    const result = findAutoConnections(outputs, inputs, new Set());
    expect(result).toHaveLength(0);
  });

  test('each output used at most once', () => {
    const outputs: OutputDef[] = [{ name: 'id', type: 'string' }];
    const inputs: InputDef[] = [
      { name: 'vpc_id', type: 'string', required: true },
      { name: 'subnet_id', type: 'string', required: true },
    ];

    const result = findAutoConnections(outputs, inputs, new Set());
    expect(result).toHaveLength(1);
  });

  test('prefers higher-scored matches', () => {
    const outputs: OutputDef[] = [
      { name: 'vpc_id', type: 'string' },
      { name: 'arn', type: 'string' },
    ];
    const inputs: InputDef[] = [{ name: 'vpc_id', type: 'string', required: true }];

    const result = findAutoConnections(outputs, inputs, new Set());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ from: 'vpc_id', to: 'vpc_id', score: 100 });
  });

  test('returns empty for no outputs', () => {
    const result = findAutoConnections(
      [],
      [{ name: 'vpc_id', type: 'string', required: true }],
      new Set(),
    );
    expect(result).toHaveLength(0);
  });

  test('returns empty for no inputs', () => {
    const result = findAutoConnections([{ name: 'vpc_id', type: 'string' }], [], new Set());
    expect(result).toHaveLength(0);
  });
});
