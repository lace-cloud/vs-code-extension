import * as vscode from 'vscode';
import { createAutosaveKeeper } from './autosave/autosave-policy';
import { failureText } from './engine/command-outcome';
import { createEngine, type Engine, engineManager, engineSettings } from './engine/engine';
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
  const rootSessions = createRootSessions({ engine, report });
  // Attached for the window's whole life: deactivation's dispose of the root
  // sessions flushes every session's autosave and detaches it.
  const autosave = createAutosaveKeeper(vscode, (line) => log.appendLine(line));
  rootSessions.observe(autosave.attach);
  const host = windowHost({ api: vscode, context, engine, rootSessions, autosave, log, report });
  context.subscriptions.push(autosave, ...FEATURES.map((feature) => feature(host)));
  active = { engine, rootSessions, log };
  return { engine, rootSessions };
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
