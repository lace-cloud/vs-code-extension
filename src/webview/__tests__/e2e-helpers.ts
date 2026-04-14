/**
 * Shared E2E test infrastructure.
 *
 * Provides binary resolution, CLI server lifecycle, fixture loading,
 * and chat tool registration — used by all E2E test files.
 *
 * Prerequisites: `lace` binary installed (set LACE_BINARY or have it in PATH).
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { join } from 'path';
import { readFileSync } from 'fs';

import { LaceClient } from '../../utilities/engine/grpc-client';
import { getToolHandler } from '../../chat/tool-registry';
import { registerGraphWriteTools } from '../../chat/tools/graph-write-tools';
import { registerGraphReadTools } from '../../chat/tools/graph-read-tools';
import { registerRegistryTools } from '../../chat/tools/registry-tools';
import { registerGenerateTools } from '../../chat/tools/generate-tools';
import type { CanvasView } from '../types/render';
import type { RegistryModule } from '../../types/protocol';

/* ── Binary resolution ── */

export function resolveBinary(): string {
  if (process.env.LACE_BINARY) return process.env.LACE_BINARY;
  try {
    return execSync('which lace', { encoding: 'utf-8' }).trim();
  } catch {
    // not found
  }
  throw new Error(
    [
      'lace binary not found.',
      '',
      'Install it:',
      '  wget https://releases.lace.cloud/lace-cli-linux-amd64 -O lace',
      '  chmod +x lace && sudo mv lace /usr/local/bin/',
      '',
      'Or set LACE_BINARY=/path/to/lace before running tests.',
    ].join('\n'),
  );
}

/* ── Server lifecycle ── */

export async function spawnServer(
  binary: string,
): Promise<{ process: ChildProcess; client: LaceClient }> {
  const proc = spawn(binary, ['module', 'serve'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for LACE_GRPC_PORT')),
      10000,
    );
    let buffer = '';
    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/LACE_GRPC_PORT=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Process exited with code ${code} before reporting port`));
    });
  });

  const client = new LaceClient(port);
  return { process: proc, client };
}

/* ── Fixture loading ── */

const FIXTURES_DIR = join(__dirname, 'fixtures');

export function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

/* ── Chat tool registration ── */

export function registerAllChatTools(
  client: LaceClient,
  canvasViewRef: { current: CanvasView | undefined },
  registryModules: RegistryModule[],
  laceDir: string,
) {
  const deps = {
    getRpcClient: () => client,
    getRegistryModules: () => registryModules,
    getUserOrgs: () => [] as Array<{ slug: string; name: string; role: string }>,
    getCanvasView: () => canvasViewRef.current,
    publishCanvasView: (state: CanvasView) => {
      canvasViewRef.current = state;
    },
  };

  registerRegistryTools(deps);
  registerGraphReadTools(deps);
  registerGraphWriteTools(deps);
  registerGenerateTools({
    getRpcClient: () => client,
    getLaceDir: () => laceDir,
  });
}

/* ── Chat tool caller ── */

export async function callTool(name: string, params: Record<string, unknown> = {}) {
  const handler = getToolHandler(name);
  if (!handler) throw new Error(`Tool "${name}" not registered`);
  return handler(params);
}

export async function callToolExpectSuccess(name: string, params: Record<string, unknown> = {}) {
  const result = await callTool(name, params);
  if (result.isError) {
    throw new Error(`Tool "${name}" failed: ${result.content}`);
  }
  return result;
}
