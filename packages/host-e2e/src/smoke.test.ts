// Host smoke tests — Plan 2 Phase G.
//
// Drives a real VS Code (via @vscode/test-electron) with the Lace
// extension loaded, asserting the host contributions all wire up
// correctly on activation: commands register, the chat sidebar view
// provider mounts, and the canvas panel opens as a webview on
// `lace.openCanvas`. Purely behavioural — no webview DOM assertions;
// those live in the Playwright flow tests against Storybook.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

// Waits for the extension's exported activation to finish. Returns the
// extension so callers can read its exports if needed — today we don't,
// but the activation handshake is itself the signal we want.
async function activateLaceExtension() {
  const ext = vscode.extensions.getExtension('LaceCloudInc.lace-cloud');
  assert.ok(
    ext,
    'Lace extension not found — check packages/host-e2e/.vscode-test.mjs extensionDevelopmentPath',
  );
  if (!ext.isActive) await ext.activate();
  return ext;
}

// Closes every open editor + webview panel between tests so one test's
// opened canvas doesn't leak into the next. `closeAllEditors` covers
// regular editors and webview panels alike.
async function closeAllEditorsAndPanels() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

describe('host smoke', () => {
  before(async () => {
    await activateLaceExtension();
  });

  afterEach(closeAllEditorsAndPanels);

  it('activates and registers the full Lace command surface', async () => {
    const expected = [
      'lace.startEngine',
      'lace.stopEngine',
      'lace.restartEngine',
      'lace.openCanvas',
      'lace.openLogs',
      'lace.refreshRegistry',
      'lace.showModuleDetail',
      'lace.addModuleToCanvas',
      'lace.addModule',
      'lace.generate',
      'lace.terraformValidate',
      'lace.terraformFmt',
      'lace.terraformScan',
      'lace.terraformDocs',
      'lace.clearChatHistory',
    ];
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = expected.filter((c) => !registered.has(c));
    assert.deepEqual(missing, [], `missing commands after activation: ${missing.join(', ')}`);
  });

  it('contributes the Lace view container (registry + chat sidebars)', async () => {
    // View contributions live in package.json; VS Code enforces their
    // presence by making the matching `workbench.view.extension.<id>`
    // command available. If the container didn't register, this call
    // rejects — we assert the happy path runs through.
    await vscode.commands.executeCommand('workbench.view.extension.laceContainer');
  });

  it('opens a Lace canvas webview panel on lace.openCanvas', async () => {
    const initialCount = countLaceTabs();
    // Tab population travels via VS Code's tab-group event loop, so we
    // subscribe before firing the command and race the open against a
    // deadline — avoids a race with executeCommand's synchronous return.
    const tabOpened = waitForLaceTabOpen(2000);
    await vscode.commands.executeCommand('lace.openCanvas');
    await tabOpened;
    const after = countLaceTabs();
    assert.ok(
      after > initialCount,
      `expected a Lace tab after openCanvas; before=${initialCount}, after=${after}`,
    );
  });
});

// Counts open tabs whose label starts with `Lace · ` — matches the
// title set by canvas-panel.ts's `createWebviewPanel` call.
function countLaceTabs(): number {
  let n = 0;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.label.startsWith('Lace · ')) n++;
    }
  }
  return n;
}

// Resolves on the first tab-change event that surfaces a Lace tab.
// Rejects with a timeout error if the tab never appears.
function waitForLaceTabOpen(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const subscription = vscode.window.tabGroups.onDidChangeTabs((e) => {
      if (e.opened.some((t) => t.label.startsWith('Lace · '))) {
        clearTimeout(timer);
        subscription.dispose();
        resolve();
      }
    });
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for Lace tab to open`));
    }, timeoutMs);
  });
}
