import { describe, it, expect } from 'vitest';
import { emptyWorkspace, toBundle, fromBundle } from '../utils/bundle';
import { parseModuleKey } from '../utils/identifiers';
import { allChildren } from '../utils/children';

describe('emptyWorkspace', () => {
  it('creates a complete empty workspace structure', () => {
    const ws = emptyWorkspace('my-project');
    const rootKey = ws.entry;
    const rootDef = ws.modules[rootKey];

    // Entry
    expect(ws.schema_version).toBe('1.0');
    expect(ws.kind).toBe('bundle');
    expect(ws.entry).toBe('my-project@v1.0.0');

    // Root module def
    expect(rootDef).toBeDefined();
    expect(allChildren(rootDef)).toEqual([]);
    expect(rootDef.exports.outputs).toEqual({});
    expect(rootDef.interface.inputs).toEqual([]);
    expect(rootDef.interface.outputs).toEqual([]);

    // Layout
    expect(ws.layouts[rootKey]).toEqual({ nodes: {} });
  });

  it('sanitizes folder name to terraform identifier', () => {
    const ws = emptyWorkspace('My Cool Project!');
    const { id } = parseModuleKey(ws.entry);
    expect(id).toBe('My_Cool_Project_');
  });

  it('round-trips through toBundle → fromBundle', () => {
    const ws = emptyWorkspace('round-trip');
    const bundle = toBundle(ws);
    const { workspace: restored, errors } = fromBundle(bundle);

    expect(errors).toEqual([]);
    expect(restored.entry).toEqual(ws.entry);
    expect(restored.schema_version).toBe(ws.schema_version);

    const rootKey = ws.entry;
    const original = ws.modules[rootKey];
    const roundTripped = restored.modules[rootKey];

    expect(roundTripped.id).toBe(original.id);
    expect(roundTripped.version).toBe(original.version);
    expect(roundTripped.interface).toEqual(original.interface);
  });
});
