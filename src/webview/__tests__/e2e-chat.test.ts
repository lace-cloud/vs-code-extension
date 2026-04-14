/**
 * E2E Chat Tests — user works through the chat interface.
 *
 * Exercises the chat tool chain against the real CLI binary.
 * Each test replicates a real chat session: register tools with a live
 * LaceClient, call tools in the order the model would, verify results.
 *
 * Uses local fixture bundles where possible to avoid network dependency.
 * Tests that require the live registry are marked with { timeout: 60000 }.
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { type ChildProcess } from 'child_process';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

import { LaceClient } from '../../utilities/engine/grpc-client';
import type { CanvasView } from '../types/render';
import {
  resolveBinary,
  spawnServer,
  registerAllChatTools,
  callTool,
  callToolExpectSuccess,
} from './e2e-helpers';

describe('E2E: Chat-driven workflows', () => {
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

  // ── Helper: set up a session with chat tools registered ──

  async function setupSession(name: string) {
    const srv = await spawnServer(binary);
    proc = srv.process;
    client = srv.client;

    await client.initialize('0.1.0');
    const tmpDir = mkdtempSync(join(tmpdir(), 'lace-e2e-chat-'));
    const canvas = await client.sessionOpen({ file_path: tmpDir, workspace_name: name });

    const { modules } = await client.listRegistryModules({ system: 'aws' });
    const canvasViewRef = { current: canvas as CanvasView | undefined };
    registerAllChatTools(client, canvasViewRef, modules, tmpDir);

    return { tmpDir, canvasViewRef, modules };
  }

  async function cleanup(tmpDir: string) {
    try {
      await client!.shutdown();
    } catch {
      /* ignore */
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // ── Search and discovery ──

  test('search → add → inspect → validate', { timeout: 30000 }, async () => {
    const { tmpDir, canvasViewRef } = await setupSession('chat-search');
    try {
      const searchResult = await callToolExpectSuccess('lace_search_registry', { query: 'vpc' });
      expect(searchResult.content).toContain('vpc');

      const addResult = await callToolExpectSuccess('lace_add_module', { name: 'aws/vpc' });
      expect(addResult.content).toContain('vpc');
      expect(canvasViewRef.current!.nodes.length).toBeGreaterThanOrEqual(1);

      const nodeId = canvasViewRef.current!.nodes[0].id;
      const inspectResult = await callToolExpectSuccess('lace_inspect_node', {
        instance_id: nodeId,
      });
      expect(inspectResult.content).toContain(nodeId);

      const validateResult = await callToolExpectSuccess('lace_validate_graph', {});
      expect(validateResult.content).toBeTruthy();

      await cleanup(tmpDir);
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  });

  // ── Error handling ──

  test('add nonexistent module → clear error, canvas unchanged', { timeout: 30000 }, async () => {
    const { tmpDir, canvasViewRef } = await setupSession('chat-notfound');
    try {
      const result = await callTool('lace_add_module', { name: 'aws/nonexistent-test-module-xyz' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
      expect(canvasViewRef.current!.nodes).toHaveLength(0);

      await cleanup(tmpDir);
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  });

  // ── Settings: locals and variables ──

  test('set local → set variable → bind to module input', { timeout: 30000 }, async () => {
    const { tmpDir, canvasViewRef } = await setupSession('chat-settings');
    try {
      const localResult = await callToolExpectSuccess('lace_set_local', {
        name: 'region',
        value: 'us-east-1',
      });
      expect(localResult.content).toContain('region');
      expect(localResult.content).toContain('us-east-1');

      const varResult = await callToolExpectSuccess('lace_set_variable', {
        name: 'vpc_cidr',
        type: 'string',
        default: '10.0.0.0/16',
        description: 'CIDR block for the VPC',
      });
      expect(varResult.content).toContain('vpc_cidr');

      const settingsResult = await callToolExpectSuccess('lace_get_settings', {});
      expect(settingsResult.content).toContain('region');

      await callToolExpectSuccess('lace_add_module', { name: 'aws/vpc' });
      const vpcId = canvasViewRef.current!.nodes[0].id;

      const setResult = await callToolExpectSuccess('lace_set_input', {
        instance_id: vpcId,
        input_name: 'cidr_block',
        variable: 'vpc_cidr',
      });
      expect(setResult.content).toContain('variable');

      await cleanup(tmpDir);
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  });

  // ── Settings: environments ──

  test('set staging and production environments', async () => {
    const { tmpDir } = await setupSession('chat-envs');
    try {
      const stagingResult = await callToolExpectSuccess('lace_set_environment', {
        environment: 'staging',
        variables: { region: 'us-west-2', instance_type: 't3.small' },
      });
      expect(stagingResult.content).toContain('staging');

      const prodResult = await callToolExpectSuccess('lace_set_environment', {
        environment: 'production',
        variables: { region: 'us-east-1', instance_type: 't3.large' },
      });
      expect(prodResult.content).toContain('production');

      const settingsResult = await callToolExpectSuccess('lace_get_settings', {});
      expect(settingsResult.content).toContain('staging');
      expect(settingsResult.content).toContain('production');

      await cleanup(tmpDir);
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  });

  // ── Validation and undo ──

  test('add module → validate → undo', { timeout: 30000 }, async () => {
    const { tmpDir, canvasViewRef } = await setupSession('chat-validate');
    try {
      await callToolExpectSuccess('lace_add_module', { name: 'aws/vpc' });
      const nodeCount = canvasViewRef.current!.nodes.length;
      expect(nodeCount).toBeGreaterThanOrEqual(1);

      const validateResult = await callToolExpectSuccess('lace_validate_graph', {});
      expect(validateResult.content).toBeTruthy();

      // Undo twice (dropBundle + syncLayout are separate operations)
      await callToolExpectSuccess('lace_undo', {});
      const undoResult = await callToolExpectSuccess('lace_undo', {});
      expect(undoResult.content).toContain('0 instance(s)');

      await cleanup(tmpDir);
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  });

  // ── Describe graph ──

  test('describe graph reflects canvas state', { timeout: 30000 }, async () => {
    const { tmpDir, canvasViewRef } = await setupSession('chat-describe');
    try {
      await callToolExpectSuccess('lace_add_module', { name: 'aws/vpc' });
      const vpcId = canvasViewRef.current!.nodes[0].id;

      const descResult = await callToolExpectSuccess('lace_describe_graph', {});
      expect(descResult.content).toContain(vpcId);
      expect(descResult.content).toContain('1 instance');

      await cleanup(tmpDir);
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  });
});
