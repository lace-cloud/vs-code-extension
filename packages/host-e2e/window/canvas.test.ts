// The canvas tab over one session per root, against the real engine: the
// tab holds its root's session and closing it ends the session; an edit
// through another client reaches the tab; a hand edit reaches the session;
// the lock keeps a second engine out; the window's files.autoSave decides
// what a close does with an unsaved edit; and the engine's restart.
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ConnectError, openEngineSession, Reason } from '@lace-cloud/canvas/engine';
import * as vscode from 'vscode';
import { createEngine, engineManager } from '../../../src/engine/engine';
import {
  COMPOSED,
  canvasTabs,
  changedTerraform,
  closeCanvas,
  ENGINE,
  frameOf,
  heldSession,
  lace,
  moduleDirectory,
  openCanvas,
  sessionFrame,
  sessionHolds,
  setName,
  setting,
  settle,
  until,
} from './lace';

describe('the canvas tab', () => {
  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await setting('files', 'autoSave', 'off');
    await setting('files', 'autoSaveDelay', undefined);
  });

  it('holds its root’s session from opening to closing, and writes no Terraform', async () => {
    const module = moduleDirectory(COMPOSED);
    await openCanvas(module);
    assert.ok(await heldSession(module), 'the root’s session is held');
    assert.ok(existsSync(module.file('.lace/.canvas/state.lace')), 'the session keeps its state');
    assert.deepEqual(changedTerraform(module), []);

    await closeCanvas(module);
    await until('the session to end', async () => (await heldSession(module)) === undefined);
  });

  it('shows another client’s edit as unsaved; Save keeps it and leaves the Terraform, Generate writes it', async () => {
    const module = moduleDirectory(COMPOSED);
    await openCanvas(module);
    await setName(module, 'second');
    await until('the tab to be dirty', () => canvasTabs(module)[0]?.isDirty);

    await settle('lace.save', module.uri);
    await until('the tab to be clean', () => canvasTabs(module)[0]?.isDirty === false);
    assert.deepEqual(changedTerraform(module), []);

    await settle('lace.generate', module.uri);
    assert.match(readFileSync(module.file('main.tf'), 'utf8'), /name\s*=\s*"second"/);
  });

  it('saves the document by its URI: the session’s state is written, the tab clears and the Terraform stays', async () => {
    const module = moduleDirectory(COMPOSED);
    const tab = await openCanvas(module);
    const before = readFileSync(module.file('.lace/.canvas/state.lace'));
    await setName(module, 'by-uri');
    await until('the tab to be dirty', () => canvasTabs(module)[0]?.isDirty);

    assert.ok(tab.input instanceof vscode.TabInputCustom);
    await vscode.workspace.save(tab.input.uri);

    await until('the tab to be clean', () => canvasTabs(module)[0]?.isDirty === false);
    assert.equal(readFileSync(module.file('.lace/.canvas/state.lace')).equals(before), false);
    assert.deepEqual(changedTerraform(module), []);
  });

  it('reads a hand edit of its Terraform with no conflict', async () => {
    const module = moduleDirectory(COMPOSED);
    await openCanvas(module);
    writeFileSync(
      module.file('main.tf'),
      readFileSync(module.file('main.tf'), 'utf8').replace('"first"', '"by-hand"'),
    );
    await until('the session to read the edit', () => sessionHolds(module, 'by-hand'));
    const frame = await sessionFrame(module);
    assert.equal(frame.conflict, null);
    assert.equal(frame.unsaved, false);
    assert.equal(canvasTabs(module)[0]?.label, module.name);
  });

  it('keeps a second engine out of its root', async () => {
    const module = moduleDirectory(COMPOSED);
    await openCanvas(module);
    const settings = { binaryPath: () => ENGINE, autoRestart: () => false };
    const other = createEngine(
      engineManager(settings, () => {}),
      settings,
    );
    try {
      const refused = await openEngineSession(await other.caller(), { root: module.path }).then(
        () => undefined,
        (error: unknown) => error,
      );
      assert.ok(refused instanceof ConnectError, `refused with ${String(refused)}`);
      assert.equal(refused.reason, Reason.REASON_ROOT_LOCKED);
    } finally {
      await other.stop();
    }
  });

  it('with files.autoSave off, closing the tab discards an unsaved edit', async () => {
    const module = moduleDirectory(COMPOSED);
    await openCanvas(module);
    await setName(module, 'discarded');
    await until('the tab to be dirty', () => canvasTabs(module)[0]?.isDirty);
    await closeCanvas(module);
    await until('the session to end', async () => (await heldSession(module)) === undefined);
    assert.equal(await sessionHolds(module, 'discarded'), false);
    assert.equal(await sessionHolds(module, 'first'), true);
  });

  it('with a second holder keeping the session, closing the tab discards what the page drew', async () => {
    const module = moduleDirectory(COMPOSED);
    await openCanvas(module);
    const { rootSessions } = await lace();
    const holder = await rootSessions.acquire(module.path);
    try {
      await setName(module, 'declined');
      await until('the tab to be dirty', () => canvasTabs(module)[0]?.isDirty);
      const { drawnDigest } = await lace();
      await until(
        'the page to report the frame it drew',
        () => drawnDigest(module.path) === frameOf(holder).workingDigest,
      );
      await closeCanvas(module);

      await until('the discard', () => !frameOf(holder).unsaved);
      const frame = frameOf(holder);
      assert.equal(frame.workingDigest, frame.savedDigest);
      assert.equal(await sessionHolds(module, 'declined'), false);
    } finally {
      await holder.release();
    }
  });

  it('with files.autoSave afterDelay, closing the tab saves an unsaved edit', async () => {
    await setting('files', 'autoSave', 'afterDelay');
    const module = moduleDirectory(COMPOSED);
    await openCanvas(module);
    await setName(module, 'kept');
    await until('the tab to be dirty', () => canvasTabs(module)[0]?.isDirty);
    await until('the autosave to clear the tab', () => canvasTabs(module)[0]?.isDirty === false);
    await closeCanvas(module);
    await until('the session to end', async () => (await heldSession(module)) === undefined);
    assert.equal(await sessionHolds(module, 'kept'), true);
    assert.equal(await sessionHolds(module, 'first'), false);
  });

  it('with files.autoSave afterDelay, closing the tab inside the delay discards an unsaved edit', async () => {
    await setting('files', 'autoSave', 'afterDelay');
    await setting('files', 'autoSaveDelay', 60_000);
    const module = moduleDirectory(COMPOSED);
    await openCanvas(module);
    await setName(module, 'inside');
    await until('the tab to be dirty', () => canvasTabs(module)[0]?.isDirty);
    await closeCanvas(module);
    await until('the session to end', async () => (await heldSession(module)) === undefined);
    assert.equal(await sessionHolds(module, 'inside'), false);
    assert.equal(await sessionHolds(module, 'first'), true);
  });

  it('opens again on its session after the engine restarts', async () => {
    const module = moduleDirectory(COMPOSED);
    await openCanvas(module);
    const before = (await heldSession(module))?.sessionId;
    await vscode.commands.executeCommand('lace.restartEngine');
    await until('the root’s session to be held again', async () => {
      const after = await heldSession(module);
      return after !== undefined && after.sessionId !== before;
    });
    assert.equal(canvasTabs(module).length, 1);
    assert.ok(await sessionHolds(module, 'first'));
  });
});

describe('an engine that cannot start', () => {
  after(async () => {
    await setting('lace', 'binaryPath', ENGINE);
    await vscode.commands.executeCommand('lace.restartEngine');
  });

  it('opens no canvas and holds no session', async () => {
    const module = moduleDirectory(COMPOSED);
    const { engine } = await lace();
    await engine.stop();
    await setting('lace', 'binaryPath', `${ENGINE}-missing`);
    await settle('lace.openCanvas', module.uri);
    assert.deepEqual(canvasTabs(module), []);
    assert.equal(await heldSession(module), undefined);
  });
});
