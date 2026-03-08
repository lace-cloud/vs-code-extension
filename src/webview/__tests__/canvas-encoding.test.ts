import { describe, it, expect } from 'vitest';
import { encodeCanvasState, decodeCanvasState, isBinaryFormat } from '../canvas-encoding';
import type { WorkspaceState } from '../types/workspace';

const MAGIC = Buffer.from([0x4c, 0x41, 0x43, 0x45]);

function makeMinimalState(): WorkspaceState {
  return {
    schema_version: '1.0',
    kind: 'bundle',
    entry: 'test@v1.0.0',
    modules: {
      'test@v1.0.0': {
        id: 'test',
        version: 'v1.0.0',
        interface: { inputs: [], outputs: [] },
        modules: [],
        resources: [],
        exports: { outputs: {} },
      },
    },
    layouts: {
      'test@v1.0.0': { nodes: {} },
    },
  } as WorkspaceState;
}

describe('canvas-encoding', () => {
  it('round-trips encode -> decode', () => {
    const state = makeMinimalState();
    const encoded = encodeCanvasState(state);
    const decoded = decodeCanvasState(encoded);
    expect(decoded).toEqual(state);
  });

  it('starts with LACE magic bytes and version', () => {
    const encoded = encodeCanvasState(makeMinimalState());
    expect(encoded.subarray(0, 4).equals(MAGIC)).toBe(true);
    expect(encoded[4]).toBe(0x01);
  });

  it('throws on invalid magic bytes', () => {
    const bad = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x01, 0x00]);
    expect(() => decodeCanvasState(bad)).toThrow('Not a Lace canvas file');
  });

  it('throws on unsupported version', () => {
    const buf = encodeCanvasState(makeMinimalState());
    buf[4] = 0x99;
    expect(() => decodeCanvasState(buf)).toThrow('Unsupported format version: 153');
  });

  it('throws on file too small', () => {
    expect(() => decodeCanvasState(Buffer.from([0x4c, 0x41]))).toThrow('File too small');
  });

  it('isBinaryFormat returns true for binary', () => {
    const encoded = encodeCanvasState(makeMinimalState());
    expect(isBinaryFormat(encoded)).toBe(true);
  });

  it('isBinaryFormat returns false for JSON', () => {
    const json = Buffer.from(JSON.stringify(makeMinimalState()), 'utf-8');
    expect(isBinaryFormat(json)).toBe(false);
  });

  it('round-trips empty layouts', () => {
    const state = makeMinimalState();
    state.layouts = {};
    const decoded = decodeCanvasState(encodeCanvasState(state));
    expect(decoded.layouts).toEqual({});
  });
});
