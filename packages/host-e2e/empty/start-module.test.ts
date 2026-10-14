// A workspace that holds no Terraform, against the real engine: Lace: Open
// Canvas from the palette starts the module in the workspace's folder, on a
// canvas that is editable, and writes no Terraform: what is new in the tree
// is the session's state and its lock, and the module's first Terraform is
// its first Generate's.
import * as assert from 'node:assert/strict';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import { canvasTabs, frameOf, git, lace, until, workspace } from '../window/lace';

// Every path git lists as changed or untracked, each untracked file by its
// own path.
const changed = (): string[] =>
  git('status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));

describe('a workspace that holds no Terraform', () => {
  it('Lace: Open Canvas from the palette starts the module in the workspace folder, on an editable canvas, writing no Terraform', async () => {
    const before = changed();
    const title = basename(workspace());

    await vscode.commands.executeCommand('lace.openCanvas');
    await until('the canvas of the workspace folder to open', () =>
      canvasTabs().some((tab) => tab.label === title),
    );
    assert.deepEqual(
      canvasTabs().map((tab) => tab.label),
      [title],
    );

    const { rootSessions } = await lace();
    assert.deepEqual(
      rootSessions.held().map((session) => session.root),
      [workspace()],
    );
    const hold = await rootSessions.acquire(workspace());
    try {
      assert.equal(frameOf(hold).sourceRefused, false);
    } finally {
      await hold.release();
    }

    const after = changed();
    assert.deepEqual(
      after.filter((path) => path.endsWith('.tf') || path.endsWith('.tf.json')),
      [],
    );
    assert.deepEqual(
      after.filter((path) => !before.includes(path)),
      ['.lace/.canvas/state.lace', '.lace/.canvas/state.lace.lock'],
    );
  });
});
