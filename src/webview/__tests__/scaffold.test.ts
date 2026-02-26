import { describe, it, expect } from 'vitest';
import { emptyWorkspace, toBundle, fromBundle } from '../utils/bundle';
import { makeModuleKey } from '../utils/identifiers';

describe('emptyWorkspace', () => {
  it('creates a complete empty workspace structure', () => {
    const ws = emptyWorkspace('my-project');
    const rootKey = makeModuleKey(ws.entry.module_id, ws.entry.version);
    const rootDef = ws.modules[rootKey];

    // Entry
    expect(ws.schema_version).toBe('1.0');
    expect(ws.kind).toBe('module_bundle');
    expect(ws.entry).toEqual({ module_id: 'my-project', version: 'v1.0.0' });

    // Root module def
    expect(rootDef).toBeDefined();
    expect(rootDef.kind).toBe('module_def');
    expect(rootDef.graph.instances).toEqual([]);
    expect(rootDef.graph.exports.outputs).toEqual({});
    expect(rootDef.interface.inputs).toEqual([]);
    expect(rootDef.interface.outputs).toEqual([]);

    // Layout
    expect(ws.layouts[rootKey]).toEqual({ nodes: {} });
  });

  it('sanitizes folder name to terraform identifier', () => {
    const ws = emptyWorkspace('My Cool Project!');
    expect(ws.entry.module_id).toBe('My_Cool_Project_');
  });

  it('round-trips through toBundle → fromBundle', () => {
    const ws = emptyWorkspace('round-trip');
    const bundle = toBundle(ws);
    const { workspace: restored, errors } = fromBundle(bundle);

    expect(errors).toEqual([]);
    expect(restored.entry).toEqual(ws.entry);
    expect(restored.schema_version).toBe(ws.schema_version);

    const rootKey = makeModuleKey(ws.entry.module_id, ws.entry.version);
    const original = ws.modules[rootKey];
    const roundTripped = restored.modules[rootKey];

    expect(roundTripped.id).toBe(original.id);
    expect(roundTripped.version).toBe(original.version);
    expect(roundTripped.interface).toEqual(original.interface);
  });
});
