// Release-CLI integration test.
//
// Spawns the public release binary at /usr/local/bin/lace (installed by
// the install-release-cli composite in CI) via @lace-cloud/host's
// ServerManager, then drives the unauth RPC surface (initialize,
// authStatus) through LaceTransport. Verifies that the released CLI
// still speaks the handshake + gRPC protocol this extension version
// expects — catches CLI ↔ extension drift before it reaches Marketplace.
//
// Why ServerManager instead of raw child_process + gRPC: the extension
// uses exactly this code path at runtime, so the test exercises the
// real wire layer. If the release CLI changes its handshake format
// incompatibly, ServerManager.start() rejects loudly here.

import * as assert from 'node:assert/strict';
import { ServerManager } from '@lace-cloud/host';

const BINARY_PATH = process.env.LACE_BINARY_PATH ?? '/usr/local/bin/lace';
const STATE_TIMEOUT_MS = 10_000;

function waitForState(
  server: ServerManager,
  target: 'running' | 'stopped',
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server.currentState === target) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      server.off('stateChange', onState);
      reject(
        new Error(
          `timed out after ${timeoutMs}ms waiting for ServerManager state '${target}' (last state: ${server.currentState})`,
        ),
      );
    }, timeoutMs);
    const onState = (state: string) => {
      if (state === target) {
        clearTimeout(timer);
        server.off('stateChange', onState);
        resolve();
      } else if (state === 'error') {
        clearTimeout(timer);
        server.off('stateChange', onState);
        reject(new Error(`ServerManager entered 'error' state while awaiting '${target}'`));
      }
    };
    server.on('stateChange', onState);
  });
}

describe('release CLI integration', () => {
  let server: ServerManager | undefined;

  before(async () => {
    server = new ServerManager({
      log: (msg) => console.log(`[lace-engine] ${msg}`),
      getBinaryPath: () => BINARY_PATH,
      getAutoRestart: () => false,
    });
    await server.start();
    await waitForState(server, 'running', STATE_TIMEOUT_MS);
  });

  after(async () => {
    if (!server) return;
    try {
      await server.stop();
      await waitForState(server, 'stopped', STATE_TIMEOUT_MS);
    } finally {
      server.dispose();
    }
  });

  it('handshake parses + transport is live', () => {
    assert.ok(server, 'ServerManager not constructed');
    assert.equal(server.currentState, 'running');
    assert.ok(server.transport, 'LaceTransport not attached after start');
  });

  it('initialize RPC round-trips and returns a server version', async () => {
    const transport = server?.transport;
    assert.ok(transport, 'transport missing');
    const res = await transport.initialize('lace-cloud/vs-code-extension host-e2e');
    assert.equal(typeof res.serverVersion, 'string');
    assert.match(
      res.serverVersion,
      /^v?\d+\.\d+\.\d+/,
      `serverVersion not a semver: ${res.serverVersion}`,
    );
  });

  it('authStatus RPC returns a boolean', async () => {
    const transport = server?.transport;
    assert.ok(transport, 'transport missing');
    const res = await transport.authStatus();
    assert.equal(typeof res.authenticated, 'boolean');
  });
});
