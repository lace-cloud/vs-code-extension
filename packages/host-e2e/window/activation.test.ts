// The extension activates in a trusted folder, hands back its engine and
// root sessions, registers every command its manifest declares, and runs an
// engine that speaks its protocol and routes every command it binds.
import * as assert from 'node:assert/strict';
import { CORE_COMMAND_ACTIONS, openEngineCommands } from '@lace-cloud/canvas/engine';
import * as vscode from 'vscode';
import { EXTENSION, lace, workspace } from './lace';

describe('activation', () => {
  it('hands back the window’s engine and root sessions', async () => {
    const { engine, rootSessions } = await lace();
    assert.equal(typeof engine.caller, 'function');
    assert.deepEqual(rootSessions.held(), []);
  });

  it('registers every command the manifest declares', async () => {
    await lace();
    const declared: { command: string }[] =
      vscode.extensions.getExtension(EXTENSION)?.packageJSON.contributes.commands ?? [];
    const registered = new Set(await vscode.commands.getCommands(true));
    assert.deepEqual(
      declared.map(({ command }) => command).filter((command) => !registered.has(command)),
      [],
    );
  });

  it('starts an engine of its protocol, which routes every command the canvas binds', async () => {
    const { engine } = await lace();
    await engine.start();
    assert.equal(engine.state(), 'running');
    const commands = await openEngineCommands(await engine.caller(), { cwd: workspace() });
    const routed = commands.available();
    const bound = CORE_COMMAND_ACTIONS.flatMap((action) =>
      action.binding.kind === 'command' ? [action.binding.path] : [],
    );
    assert.deepEqual(
      bound.filter((path) => !routed.has(path)),
      [],
    );
  });
});
