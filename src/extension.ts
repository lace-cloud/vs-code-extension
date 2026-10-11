import * as vscode from 'vscode';
import { createAutosaveKeeper } from './autosave/autosave-policy';
import { createEngine, type Engine, engineManager, engineSettings } from './engine/engine';
import { createRootSessions, type RootSessions } from './engine/root-sessions';
import { FEATURES, windowHost } from './features';

// What activation hands back: the window's engine and its root sessions.
export type LaceExtension = { engine: Engine; rootSessions: RootSessions };

let active: LaceExtension | null = null;

export function activate(context: vscode.ExtensionContext): LaceExtension {
  const log = vscode.window.createOutputChannel('Lace');
  const settings = engineSettings(vscode.workspace);
  const engine = createEngine(
    engineManager(settings, (line) => log.appendLine(line)),
    settings,
  );
  const report = (what: string, error: unknown) =>
    log.appendLine(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  const rootSessions = createRootSessions({ engine, report });
  // Attached for the window's whole life: deactivation's dispose of the root
  // sessions flushes every session's autosave and detaches it.
  const autosave = createAutosaveKeeper(vscode, (line) => log.appendLine(line));
  rootSessions.observe(autosave.attach);
  const host = windowHost({ api: vscode, context, engine, rootSessions, autosave, log, report });
  context.subscriptions.push(log, autosave, ...FEATURES.map((feature) => feature(host)));
  active = { engine, rootSessions };
  return active;
}

// The window is closing, and VS Code ends the extension host a few seconds
// after this begins. Held sessions are saved first, as their autosave policy
// says; stopping the engine then closes every session and frees every lock.
export async function deactivate(): Promise<void> {
  if (!active) return;
  const { engine, rootSessions } = active;
  active = null;
  await rootSessions.dispose();
  await engine.stop();
}
