import { describe, it, expect } from 'vitest';
import { emptyWorkspace, toBundle, fromBundle } from '../utils/bundle';

describe('emptyWorkspace', () => {
  it('creates a valid workspace from a folder name', () => {
    const ws = emptyWorkspace('my-project');
    expect(ws.schema_version).toBe('1.0');
    expect(ws.kind).toBe('module_bundle');
    expect(ws.entry.module_id).toBe('my-project');
    expect(ws.entry.version).toBe('v1.0.0');
  });

  it('sanitizes folder name to terraform identifier', () => {
    const ws = emptyWorkspace('My Cool Project!');
    expect(ws.entry.module_id).toBe('My_Cool_Project_');
  });

  it('has a root composite module with empty graph', () => {
    const ws = emptyWorkspace('test');
    const rootKey = `${ws.entry.module_id}@${ws.entry.version}`;
    const rootDef = ws.modules[rootKey];

    expect(rootDef).toBeDefined();
    expect(rootDef.kind).toBe('module_def');
    expect(rootDef.graph).toBeDefined();
    expect(rootDef.graph.instances).toEqual([]);
    expect(rootDef.graph.exports.outputs).toEqual({});
  });

  it('has an empty layout for the root module', () => {
    const ws = emptyWorkspace('test');
    const rootKey = `${ws.entry.module_id}@${ws.entry.version}`;
    expect(ws.layouts?.[rootKey]).toEqual({ nodes: {} });
  });

  it('has empty interface on root module', () => {
    const ws = emptyWorkspace('test');
    const rootKey = `${ws.entry.module_id}@${ws.entry.version}`;
    const rootDef = ws.modules[rootKey];
    expect(rootDef.interface.inputs).toEqual([]);
    expect(rootDef.interface.outputs).toEqual([]);
  });

  it('round-trips through toBundle → fromBundle', () => {
    const ws = emptyWorkspace('round-trip');
    const bundle = toBundle(ws);
    const { workspace: restored, errors } = fromBundle(bundle);

    expect(errors).toEqual([]);
    expect(restored.entry).toEqual(ws.entry);
    expect(restored.schema_version).toBe(ws.schema_version);

    const rootKey = `${ws.entry.module_id}@${ws.entry.version}`;
    const original = ws.modules[rootKey];
    const roundTripped = restored.modules[rootKey];

    expect(roundTripped.id).toBe(original.id);
    expect(roundTripped.version).toBe(original.version);
    expect(roundTripped.interface).toEqual(original.interface);
  });
});
