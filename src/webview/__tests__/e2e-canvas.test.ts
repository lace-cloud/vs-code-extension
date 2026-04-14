/**
 * E2E Canvas Tests — user works directly on the canvas via RPC.
 *
 * Exercises the full extension ↔ CLI contract through the gRPC transport.
 * All tests use local fixture bundles (no network calls).
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { type ChildProcess } from 'child_process';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

import { LaceClient } from '../../utilities/engine/grpc-client';
import { resolveBinary, spawnServer, loadFixture } from './e2e-helpers';

describe('E2E: Canvas workflows', () => {
  let binary: string;
  let proc: ChildProcess | undefined;
  let client: LaceClient | undefined;

  beforeAll(() => {
    binary = resolveBinary();
  });

  afterEach(async () => {
    try {
      client?.dispose();
    } catch {
      /* ignore */
    }
    try {
      proc?.kill();
    } catch {
      /* ignore */
    }
    proc = undefined;
    client = undefined;
  });

  // ── Session lifecycle ──

  test('session open → validate → generate (dry-run) → shutdown', async () => {
    const srv = await spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    const init = await client.initialize('0.1.0');
    expect(init.serverVersion).toBeTruthy();

    const tmpDir = mkdtempSync(join(tmpdir(), 'lace-e2e-'));
    try {
      const canvas = await client.sessionOpen({ file_path: tmpDir, workspace_name: 'e2e-test' });
      expect(canvas.module_name).toBe('e2e-test');
      expect(canvas.nodes).toHaveLength(0);

      const validateResult = await client.queryValidate();
      expect(validateResult.errors).toHaveLength(0);

      const genResult = await client.sessionGenerate({
        output_dir: tmpDir,
        options: { dry_run: true },
      });
      expect(
        (genResult.diagnostics ?? []).filter((d: { severity: string }) => d.severity === 'error'),
      ).toHaveLength(0);

      const shutdown = await client.shutdown();
      expect(shutdown.status).toBe('ok');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('unknown RPC method returns error', async () => {
    const srv = await spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    await expect(client.dispatch('nonexistent/method', {})).rejects.toThrow();
    await client.shutdown();
  });

  // ── Module placement ──

  test('drop single leaf module', async () => {
    const srv = await spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    const tmpDir = mkdtempSync(join(tmpdir(), 'lace-e2e-'));
    try {
      await client.sessionOpen({ file_path: tmpDir, workspace_name: 'leaf-test' });

      const cv = await client.dropBundle({ deploy_bundle: loadFixture('iam-role.bundle') });
      expect(cv.nodes).toHaveLength(1);
      expect(cv.nodes[0].kind).toBe('resource');

      const config = await client.queryNodeConfig({ instance_id: cv.nodes[0].id });
      expect(config.instance_id).toBe(cv.nodes[0].id);

      await client.shutdown();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('drop composite module (flattens to leaf nodes)', async () => {
    const srv = await spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    const tmpDir = mkdtempSync(join(tmpdir(), 'lace-e2e-'));
    try {
      await client.sessionOpen({ file_path: tmpDir, workspace_name: 'composite-test' });

      const cv = await client.dropBundle({ deploy_bundle: loadFixture('iam-stack.bundle') });
      expect(cv.nodes).toHaveLength(3);

      const nodeIds = new Set(cv.nodes.map((n) => n.id));
      expect(nodeIds.has('iam_role')).toBe(true);
      expect(nodeIds.has('policy')).toBe(true);
      expect(nodeIds.has('attachment')).toBe(true);

      // Pre-wired bindings
      expect(cv.edges.length).toBeGreaterThanOrEqual(2);

      await client.shutdown();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Wiring ──

  test('compose step-by-step: drop 3 modules + connect', async () => {
    const srv = await spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    const tmpDir = mkdtempSync(join(tmpdir(), 'lace-e2e-'));
    try {
      await client.sessionOpen({ file_path: tmpDir, workspace_name: 'wire-test' });

      const cv1 = await client.dropBundle({ deploy_bundle: loadFixture('iam-role.bundle') });
      const roleId = cv1.nodes[0].id;

      const cv2 = await client.dropBundle({ deploy_bundle: loadFixture('iam-policy.bundle') });
      const policyId = cv2.nodes.find((n) => n.id !== roleId)!.id;

      const cv3 = await client.dropBundle({
        deploy_bundle: loadFixture('iam-policy-attachment.bundle'),
      });
      const attachId = cv3.nodes.find((n) => n.id !== roleId && n.id !== policyId)!.id;

      const cv4 = await client.connect({
        source: roleId,
        target: attachId,
        source_output: 'role_name',
        target_input: 'role_name',
      });
      expect(cv4.edges.length).toBeGreaterThanOrEqual(1);

      const cv5 = await client.connect({
        source: policyId,
        target: attachId,
        source_output: 'policy_arn',
        target_input: 'policy_arn',
      });
      expect(cv5.edges.length).toBeGreaterThanOrEqual(2);

      await client.shutdown();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('cross-bundle wiring: leaf + composite', async () => {
    const srv = await spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    const tmpDir = mkdtempSync(join(tmpdir(), 'lace-e2e-'));
    try {
      await client.sessionOpen({ file_path: tmpDir, workspace_name: 'cross-wire-test' });

      const cv1 = await client.dropBundle({ deploy_bundle: loadFixture('iam-role.bundle') });
      const roleId = cv1.nodes[0].id;

      const cv2 = await client.dropBundle({
        deploy_bundle: loadFixture('cloudwatch-logs-policy.bundle'),
      });
      const attachNode = cv2.nodes.find((n) => n.id === 'attachment');
      expect(attachNode).toBeDefined();

      const cv3 = await client.connect({
        source: roleId,
        target: 'attachment',
        source_output: 'role_name',
        target_input: 'role_name',
      });
      expect(cv3.edges.length).toBeGreaterThan(cv2.edges.length);

      const validation = await client.queryValidate();
      expect(validation.errors).toHaveLength(0);

      await client.shutdown();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Undo/Redo ──

  test('undo/redo after composition', async () => {
    const srv = await spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    const tmpDir = mkdtempSync(join(tmpdir(), 'lace-e2e-'));
    try {
      await client.sessionOpen({ file_path: tmpDir, workspace_name: 'undo-test' });

      const cv = await client.dropBundle({ deploy_bundle: loadFixture('iam-stack.bundle') });
      expect(cv.nodes).toHaveLength(3);
      expect(cv.can_undo).toBe(true);

      const undoCv = await client.undo();
      expect(undoCv.nodes).toHaveLength(0);
      expect(undoCv.can_redo).toBe(true);

      const redoCv = await client.redo();
      expect(redoCv.nodes).toHaveLength(3);

      await client.shutdown();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Persistence ──

  test('session persistence: save → close → reopen', async () => {
    const srv = await spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    const tmpDir = mkdtempSync(join(tmpdir(), 'lace-e2e-'));
    try {
      await client.sessionOpen({ file_path: tmpDir, workspace_name: 'persist-test' });

      const cv = await client.dropBundle({ deploy_bundle: loadFixture('iam-stack.bundle') });
      const nodeCount = cv.nodes.length;
      const edgeCount = cv.edges.length;

      const saveResult = await client.sessionSave();
      expect(saveResult.saved).toBe(true);

      await client.sessionClose();

      const reopened = await client.sessionOpen({
        file_path: tmpDir,
        workspace_name: 'persist-test',
      });
      expect(reopened.nodes).toHaveLength(nodeCount);
      expect(reopened.edges).toHaveLength(edgeCount);

      await client.shutdown();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Generate ──

  test('generate dry-run on composed canvas', async () => {
    const srv = await spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    const tmpDir = mkdtempSync(join(tmpdir(), 'lace-e2e-'));
    try {
      await client.sessionOpen({ file_path: tmpDir, workspace_name: 'gen-test' });

      await client.dropBundle({ deploy_bundle: loadFixture('iam-stack.bundle') });

      const validation = await client.queryValidate();
      expect(validation.errors).toHaveLength(0);

      const gen = await client.sessionGenerate({
        output_dir: tmpDir,
        options: { dry_run: true },
      });
      expect(
        (gen.diagnostics ?? []).filter((d: { severity: string }) => d.severity === 'error'),
      ).toHaveLength(0);

      await client.shutdown();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
