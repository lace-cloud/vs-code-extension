/**
 * End-to-End Integration Test: Extension ↔ Lace CLI over JSON-RPC
 *
 * Spawns the real `lace module serve` binary and exercises the full
 * extension→CLI contract through the actual JSONRPCClient transport:
 *
 *   1. Spawn `lace module serve` child process over stdio
 *   2. Initialize (version handshake + capability exchange)
 *   3. Build workspace via reducer (DROP_BUNDLE, UPDATE_INPUTS)
 *   4. Export workspace → ModuleBundle via toBundle (wire derivation)
 *   5. Validate bundle over RPC (server-side structural checks)
 *   6. Generate Terraform in dry-run mode over RPC
 *   7. Verify generated HCL: correct module blocks, sources, bindings
 *   8. Shutdown gracefully
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
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';

import { JSONRPCClient } from '../../utilities/engine/rpc-client';
import { emptyWorkspace, fromBundle, toBundle } from '../utils/bundle';
import { workspaceReducer } from '../state/reducer';
import { validateWorkspace } from '../utils/validate';
import type { WorkspaceState } from '../types/workspace';
import type { ModuleBundle } from '../types/ir';

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

/* ── Fixture helpers ── */

function loadFixture(name: string): any {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

/** Normalize a raw fixture through fromBundle (matches Canvas.tsx production path). */
function loadNormalizedBundle(name: string): ModuleBundle {
  const raw = loadFixture(name);
  const { workspace } = fromBundle(raw);
  const { layouts: _layouts, ...bundle } = workspace;
  return bundle;
}

function rootKey(ws: WorkspaceState): string {
  return `${ws.entry.module_id}@${ws.entry.version}`;
}

function entryGraph(ws: WorkspaceState) {
  const def = ws.modules[rootKey(ws)];
  return def.graph;
}

/* ── Tests ── */

describe('E2E: extension ↔ lace CLI over JSON-RPC', () => {
  let binary: string;
  let proc: ChildProcess | undefined;
  let client: JSONRPCClient | undefined;

  beforeAll(() => {
    binary = resolveBinary();
  });

  afterEach(async () => {
    try {
      client?.dispose();
    } catch {}
    try {
      proc?.kill();
    } catch {}
    proc = undefined;
    client = undefined;
  });

  test('full pipeline: workspace → validate → generate to disk → terraform fmt', async () => {
    const srv = spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    // ── 1. Initialize ──
    const init = await client.initialize('0.1.0');
    expect(init.serverVersion).toBeTruthy();
    expect(init.capabilities).toContain('validate');
    expect(init.capabilities).toContain('generate');

    // ── 2. Build workspace (extension-side: reducer + bundle layer) ──
    let ws = emptyWorkspace('my-infra');
    const rk = rootKey(ws);

    const deployBundle: ModuleBundle = loadNormalizedBundle('composite_deploy_bundle.json');
    ws = workspaceReducer(ws, {
      type: 'DROP_BUNDLE',
      module_key: rk,
      deploy_bundle: deployBundle,
      positions: {
        s3_bucket: { x: 100, y: 100 },
        s3_bucket_versioning: { x: 400, y: 100 },
      },
    });

    expect(entryGraph(ws).instances).toHaveLength(2);

    // Configure literal inputs
    ws = workspaceReducer(ws, {
      type: 'UPDATE_INPUTS',
      module_key: rk,
      instance_id: 's3_bucket',
      inputs: {
        bucket_name: { lit: 'my-production-bucket' },
        tags: { lit: { env: 'prod', team: 'platform' } },
        versioning_enabled: { lit: true },
        acl: { lit: 'private' },
      },
    });

    // Local graph validation
    expect(validateWorkspace(ws)).toHaveLength(0);

    // ── 3. Export bundle (toBundle derives wires from out-bindings) ──
    const bundle = toBundle(ws);
    expect(Object.keys(bundle.modules)).toHaveLength(3); // root + 2 leaf defs

    const exportedRoot = bundle.modules[rk];
    expect(exportedRoot.graph.wires).toHaveLength(1);
    expect(exportedRoot.graph.wires![0]).toEqual({
      from: { module: 's3_bucket', port: 'outputs.id' },
      to: { module: 's3_bucket_versioning', port: 'inputs.bucket_id' },
    });

    // layouts must NOT leak into the wire format
    expect((bundle as any).layouts).toBeUndefined();

    // ── 4. Validate bundle over RPC ──
    const validateResult = await client.validate({ bundle });
    expect(validateResult.valid).toBe(true);
    expect(validateResult.diagnostics).toHaveLength(0);

    // ── 5. Generate Terraform to disk over RPC ──
    const outDir = mkdtempSync(join(tmpdir(), 'lace-e2e-'));

    try {
      const genResult = await client.call<{
        filesWritten?: string[];
        diagnostics?: any[];
      }>('generate', {
        bundle,
        outputDir: outDir,
        options: { dryRun: false, format: true, validate: false, overwrite: true },
      });

      const errors = (genResult.diagnostics ?? []).filter((d: any) => d.severity === 'error');
      expect(errors).toHaveLength(0);
      expect(genResult.filesWritten).toBeDefined();
      expect(genResult.filesWritten!.length).toBeGreaterThan(0);

      // Verify files on disk
      const files = readdirSync(outDir);
      expect(files).toContain('main.tf');
      expect(files).toContain('module.meta.json');

      const mainTf = readFileSync(join(outDir, 'main.tf'), 'utf-8');

      // Verify module blocks
      expect(mainTf).toContain('module "s3_bucket"');
      expect(mainTf).toContain('module "s3_bucket_versioning"');

      // Verify git source from leaf def
      expect(mainTf).toContain('git::https://github.com/example/terraform-aws-s3-bucket.git');

      // Verify literal binding was serialized
      expect(mainTf).toContain('my-production-bucket');

      // Verify out-binding became a module reference
      expect(mainTf).toContain('module.s3_bucket.id');

      // ── 6. terraform fmt -check: verify CLI-formatted HCL is clean ──
      // The CLI already ran `terraform fmt` via format: true above.
      // fmt -check verifies the output is idempotent — valid, well-formatted HCL.
      // No terraform init required.
      execSync('terraform fmt -check', { cwd: outDir, encoding: 'utf-8' });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }

    // ── 7. Shutdown ──
    const shutdown = await client.shutdown();
    expect(shutdown.status).toBe('ok');
  });

  test('validate rejects invalid bundles', async () => {
    const srv = spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');

    const result = await client.validate({
      bundle: {
        schema_version: '2.0' as any,
        kind: 'module_bundle',
        entry: { module_id: 'ghost', version: 'v1' },
        modules: {},
      },
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics!.some((d: any) => d.message.includes('schema version'))).toBe(true);
    expect(result.diagnostics!.some((d: any) => d.message.includes('ghost'))).toBe(true);

    await client.shutdown();
  });

  test('validate catches dangling module references', async () => {
    const srv = spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');

    const result = await client.validate({
      bundle: {
        schema_version: '1.0',
        kind: 'module_bundle',
        entry: { module_id: 'root', version: 'v1.0.0' },
        modules: {
          'root@v1.0.0': {
            schema_version: '1.0',
            kind: 'module_def',
            id: 'root',
            version: 'v1.0.0',
            interface: { inputs: [], outputs: [] },
            graph: {
              instances: [
                {
                  id: 'orphan',
                  kind: 'module',
                  use: { module_id: 'does-not-exist', version: 'v1.0.0' },
                  inputs: {},
                },
              ],
              wires: [],
              exports: { outputs: {} },
            },
          },
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics!.some((d: any) => d.message.includes('does-not-exist'))).toBe(true);

    await client.shutdown();
  });

  test('RPC transport: method not found returns error', async () => {
    const srv = spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    await expect(client.call('nonexistent/method', {})).rejects.toThrow();
    await client.shutdown();
  });

  test('round-trip: full_bundle_with_terraform → validate → re-import', async () => {
    const srv = spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');

    const original: ModuleBundle = loadFixture('full_bundle_with_terraform.json');
    const { workspace, errors } = fromBundle(original);
    expect(errors).toHaveLength(0);

    const bundle = toBundle(workspace);

    const result = await client.validate({ bundle });
    expect(result.valid).toBe(true);

    // Re-import and verify stability
    const { workspace: reimported, errors: reErrors } = fromBundle(bundle);
    expect(reErrors).toHaveLength(0);
    expect(Object.keys(reimported.modules).length).toBe(Object.keys(workspace.modules).length);

    await client.shutdown();
  });

  test('duplicate drop deduplicates IDs and validates + generates cleanly', async () => {
    const srv = spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');

    let ws = emptyWorkspace('dedup-test');
    const rk = rootKey(ws);
    const deployBundle: ModuleBundle = loadNormalizedBundle('composite_deploy_bundle.json');

    // Drop the same bundle twice
    ws = workspaceReducer(ws, {
      type: 'DROP_BUNDLE',
      module_key: rk,
      deploy_bundle: deployBundle,
      positions: { s3_bucket: { x: 0, y: 0 }, s3_bucket_versioning: { x: 300, y: 0 } },
    });
    ws = workspaceReducer(ws, {
      type: 'DROP_BUNDLE',
      module_key: rk,
      deploy_bundle: deployBundle,
      positions: { s3_bucket: { x: 0, y: 300 }, s3_bucket_versioning: { x: 300, y: 300 } },
    });

    // 4 unique instances
    const graph = entryGraph(ws);
    expect(graph.instances).toHaveLength(4);
    expect(new Set(graph.instances.map((i) => i.id)).size).toBe(4);

    expect(validateWorkspace(ws)).toHaveLength(0);

    const bundle = toBundle(ws);

    // Server-side validation
    const result = await client.validate({ bundle });
    expect(result.valid).toBe(true);

    // 2 wires (one per pair)
    expect(bundle.modules[rk].graph.wires).toHaveLength(2);

    // Dry-run generate should produce all 4 module blocks
    const genResult = await client.call<{ files?: Record<string, string>; diagnostics?: any[] }>(
      'generate',
      { bundle, outputDir: '', options: { dryRun: true } },
    );
    expect(genResult.diagnostics).toHaveLength(0);

    const mainTf = genResult.files!['main.tf'];
    for (const inst of graph.instances) {
      expect(mainTf).toContain(`module "${inst.id}"`);
    }

    await client.shutdown();
  });
});
