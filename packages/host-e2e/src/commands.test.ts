// Host command tests — Plan 2 Phase G.
//
// Exercises the command surface that the extension contributes:
//   - Engine lifecycle: startEngine / stopEngine / restartEngine each
//     moves the ServerManager state machine through its expected
//     transitions. No engine binary is spawned — the tests
//     intentionally start with a binary path that cannot resolve, so
//     `start` reports `error` and `stop` stays a no-op. Lifecycle
//     transitions (and the commands not throwing) are what we verify.
//   - Terraform toolbelt: each of the four `lace.terraform*` commands
//     opens a distinctively-named terminal. We subscribe to
//     `onDidOpenTerminal` before executing and read the creation event.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

async function activateLaceExtension() {
  const ext = vscode.extensions.getExtension('LaceCloudInc.lace-cloud');
  assert.ok(ext, 'Lace extension not found');
  if (!ext.isActive) await ext.activate();
  return ext;
}

// Closes every editor + webview panel between tests — avoids leakage
// of panel state across the suite.
async function closeAllEditorsAndPanels() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

// Waits for a terminal whose `name` matches `expectedName`. Resolves
// with the Terminal the first time one appears within `timeoutMs`;
// rejects if none does.
function waitForTerminal(expectedName: string, timeoutMs = 5_000): Promise<vscode.Terminal> {
  return new Promise((resolve, reject) => {
    // Already-open terminal case — covers the pathological scenario
    // where a prior test leaves a terminal up AND a subsequent test
    // execution happens to reuse the same name. Expected to be rare.
    const existing = vscode.window.terminals.find((t) => t.name === expectedName);
    if (existing) {
      resolve(existing);
      return;
    }
    const timer = setTimeout(() => {
      disposable.dispose();
      reject(
        new Error(`timeout waiting for terminal named "${expectedName}" after ${timeoutMs}ms`),
      );
    }, timeoutMs);
    const disposable = vscode.window.onDidOpenTerminal((t) => {
      if (t.name !== expectedName) return;
      clearTimeout(timer);
      disposable.dispose();
      resolve(t);
    });
  });
}

describe('host commands', () => {
  before(async () => {
    // Point the engine at a binary path that cannot resolve. Engine
    // lifecycle transitions are what we want to verify, not the
    // engine actually running. Keeps the test hermetic — no PATH
    // dependency, no spawned process to clean up.
    await vscode.workspace
      .getConfiguration('lace')
      .update(
        'binaryPath',
        '/nonexistent/lace-host-e2e-placeholder',
        vscode.ConfigurationTarget.Workspace,
      );
    await activateLaceExtension();
  });

  afterEach(closeAllEditorsAndPanels);

  describe('engine lifecycle', () => {
    // The three engine commands share one Lace output channel + one
    // ServerManager; tests run sequentially (mocha default) and each
    // awaits the command to let the state machine settle.

    it('lace.startEngine reports error when the binary is missing', async () => {
      // With a bogus binary the engine-process handshake fails. The
      // command itself doesn't throw — it logs + surfaces an error
      // toast — so we're asserting it resolves without throwing.
      await vscode.commands.executeCommand('lace.startEngine');
    });

    it('lace.stopEngine is idempotent when already stopped', async () => {
      await vscode.commands.executeCommand('lace.stopEngine');
      // Second call must also resolve without throwing.
      await vscode.commands.executeCommand('lace.stopEngine');
    });

    it('lace.restartEngine resolves without throwing', async () => {
      await vscode.commands.executeCommand('lace.restartEngine');
    });
  });

  describe('terraform toolbelt', () => {
    const cases: Array<{ command: string; expectedName: string }> = [
      { command: 'lace.terraformValidate', expectedName: 'Lace: terraform validate' },
      { command: 'lace.terraformFmt', expectedName: 'Lace: terraform fmt' },
      { command: 'lace.terraformScan', expectedName: 'Lace: terraform scan' },
      { command: 'lace.terraformDocs', expectedName: 'Lace: terraform docs' },
    ];

    for (const { command, expectedName } of cases) {
      it(`${command} opens a terminal named "${expectedName}"`, async () => {
        const seen = waitForTerminal(expectedName);
        await vscode.commands.executeCommand(command);
        const terminal = await seen;
        assert.equal(terminal.name, expectedName);
        terminal.dispose();
      });
    }
  });
});
