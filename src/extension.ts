import { readlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import * as vscode from 'vscode';
import { createAutosaveKeeper } from './autosave/autosave-policy';
import { failureText } from './engine/command-outcome';
import { createEngine, type Engine, engineManager, engineSettings } from './engine/engine';
import { createRecovery } from './engine/recovery';
import { createRootSessions, type RootSessions } from './engine/root-sessions';
import { FEATURES, windowHost } from './features';

// What activation hands back: the window's engine and its root sessions.
export type LaceExtension = { engine: Engine; rootSessions: RootSessions };

// The window activation built: what it hands back, and the "Lace" Output
// channel every owner of it logs to.
let active: (LaceExtension & { log: vscode.OutputChannel }) | null = null;

export function activate(context: vscode.ExtensionContext): LaceExtension {
  const log = vscode.window.createOutputChannel('Lace');
  const settings = engineSettings(vscode.workspace);
  const engine = createEngine(
    engineManager(settings, (line) => log.appendLine(line)),
    settings,
  );
  const report = (what: string, error: unknown) => log.appendLine(`${what}: ${failureText(error)}`);
  const recovery = createRecovery({
    directory: context.globalStorageUri.fsPath,
    machine: recoveryProcessScope(),
    secrets: context.secrets,
    choose: async (root, state) => {
      if (state === 'missing') {
        const choice = await vscode.window.showWarningMessage(
          `Lace found an incomplete recovery record for ${root}, but no backup data. Remove the record?`,
          { modal: true },
          'Remove record',
        );
        return choice === 'Remove record' ? 'discard' : 'later';
      }
      const choice = await vscode.window.showWarningMessage(
        `Lace found unsaved canvas edits for ${root}. Restore them, or discard the backup?`,
        { modal: true },
        'Restore',
        'Discard',
      );
      if (choice === 'Restore') return 'restore';
      return choice === 'Discard' ? 'discard' : 'later';
    },
    report: (message) => {
      void vscode.window.showErrorMessage(message);
    },
  });
  const rootSessions = createRootSessions({ engine, report, prepare: recovery.prepare });
  rootSessions.observe(recovery.attach);
  // Attached for the window's whole life: deactivation's dispose of the root
  // sessions flushes every session's autosave and detaches it.
  const autosave = createAutosaveKeeper(vscode, (line) => log.appendLine(line));
  rootSessions.observe(autosave.attach);
  const host = windowHost({ api: vscode, context, engine, rootSessions, autosave, log, report });
  context.subscriptions.push(autosave, ...FEATURES.map((feature) => feature(host)));
  active = { engine, rootSessions, log };
  return { engine, rootSessions };
}

function recoveryProcessScope(): string | null {
  // Linux PID numbers are only meaningful within one PID namespace. If it
  // cannot be identified, another host's backups must remain untouched.
  try {
    const namespace =
      process.platform === 'linux'
        ? readlinkSync('/proc/self/ns/pid')
        : process.platform === 'darwin' || process.platform === 'win32'
          ? 'host'
          : null;
    if (!namespace || !vscode.env.machineId) return null;
    return `${vscode.env.machineId}:${hostname()}:${namespace}`;
  } catch {
    return null;
  }
}

// The window is closing, and VS Code ends the extension host a few seconds
// after this begins; it disposes the context's subscriptions without waiting
// for it. Held sessions are saved first, as their autosave policy says;
// stopping the engine then closes every session and frees every lock. The
// "Lace" channel they log to is disposed last, once they have stopped.
export async function deactivate(): Promise<void> {
  if (!active) return;
  const { engine, rootSessions, log } = active;
  active = null;
  await rootSessions.dispose();
  await engine.stop();
  log.dispose();
}
