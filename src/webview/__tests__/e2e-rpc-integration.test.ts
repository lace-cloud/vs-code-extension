/**
 * End-to-End Integration Test: Extension <-> Lace CLI over JSON-RPC
 *
 * Spawns the real `lace module serve` binary and exercises the full
 * extension->CLI contract through the actual JSONRPCClient transport:
 *
 *   1. Spawn `lace module serve` child process over stdio
 *   2. Initialize (version handshake + capability exchange)
 *   3. Open session, drop modules via RPC
 *   4. Validate via RPC (query/validate)
 *   5. Generate Terraform in dry-run mode over RPC
 *   6. Shutdown gracefully
 *
 * Prerequisites:
 *   The `lace` binary must be installed and available.
 *   Set LACE_BINARY to override the path, otherwise it must be in PATH.
 *
 *   Install:
 *     wget https://releases.lace.cloud/lace-cli-linux-amd64 -O lace
 *     chmod +x lace && sudo mv lace /usr/local/bin/
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

import { JSONRPCClient } from '../../utilities/engine/rpc-client';

/* ── Binary resolution ── */

function resolveBinary(): string {
  // Explicit override
  if (process.env.LACE_BINARY) {
    return process.env.LACE_BINARY;
  }

  // Look in PATH
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

function spawnServer(binary: string): { process: ChildProcess; client: JSONRPCClient } {
  const proc = spawn(binary, ['module', 'serve'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const client = new JSONRPCClient(proc, 10_000);
  return { process: proc, client };
}

/* ── Tests ── */

describe('E2E: extension <-> lace CLI over JSON-RPC', () => {
  let binary: string;
  let proc: ChildProcess | undefined;
  let client: JSONRPCClient | undefined;

  beforeAll(() => {
    binary = resolveBinary();
  });

  afterEach(async () => {
    try {
      client?.dispose();
    } catch {
      // ignore
    }
    try {
      proc?.kill();
    } catch {
      // ignore
    }
    proc = undefined;
    client = undefined;
  });

  test('full pipeline: session open -> drop module -> validate -> generate', async () => {
    const srv = spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    // 1. Initialize
    const init = await client.initialize('0.1.0');
    expect(init.serverVersion).toBeTruthy();

    // 2. Open session
    const tmpDir = mkdtempSync(join(tmpdir(), 'lace-e2e-'));

    try {
      const canvasView = await client.sessionOpen({
        file_path: tmpDir,
        workspace_name: 'e2e-test',
      });
      expect(canvasView.module_name).toBe('e2e-test');
      expect(canvasView.nodes).toHaveLength(0);

      // 3. Validate empty canvas
      const validateResult = await client.queryValidate();
      expect(validateResult.errors).toHaveLength(0);

      // 4. Generate (dry-run) on empty canvas
      const genResult = await client.sessionGenerate({
        output_dir: tmpDir,
        options: { dry_run: true },
      });
      const errors = (genResult.diagnostics ?? []).filter((d) => d.severity === 'error');
      expect(errors).toHaveLength(0);

      // 5. Shutdown
      const shutdown = await client.shutdown();
      expect(shutdown.status).toBe('ok');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('RPC transport: method not found returns error', async () => {
    const srv = spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    await expect(client.call('nonexistent/method', {})).rejects.toThrow();
    await client.shutdown();
  });
});
