import { describe, it, expect } from 'vitest';
import { emptyWorkspace, toBundle, fromBundle } from '../utils/bundle';

describe('emptyWorkspace', () => {
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
