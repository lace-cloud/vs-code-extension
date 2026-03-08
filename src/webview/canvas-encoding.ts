import zlib from 'zlib';
import type { WorkspaceState } from './types/workspace';

const MAGIC = Buffer.from([0x4c, 0x41, 0x43, 0x45]); // "LACE"
const FORMAT_VERSION = 0x01;
const HEADER_SIZE = 5;

export function encodeCanvasState(state: WorkspaceState): Buffer {
  const json = JSON.stringify(state);
  const compressed = zlib.gzipSync(Buffer.from(json, 'utf-8'));
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header);
  header[4] = FORMAT_VERSION;
  return Buffer.concat([header, compressed]);
}

export function decodeCanvasState(buf: Buffer): WorkspaceState {
  if (buf.length < HEADER_SIZE) throw new Error('File too small');
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Not a Lace canvas file');
  if (buf[4] !== FORMAT_VERSION) throw new Error(`Unsupported format version: ${buf[4]}`);
  const decompressed = zlib.gunzipSync(buf.subarray(HEADER_SIZE));
  return JSON.parse(decompressed.toString('utf-8'));
}

export function isBinaryFormat(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(MAGIC);
}
