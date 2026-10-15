// What tells the window the account may have changed outside it, as VS Code
// tells it, for a test to drive: the window gaining or losing focus, and a
// command line ending in one of the window's integrated terminals. And the
// document `lace whoami` answers for a developer who is signed in.
import type * as vscode from 'vscode';

type Listen<T> = (listener: (event: T) => void) => vscode.Disposable;

function listeners<T>(): { listen: Listen<T>; fire: (event: T) => void } {
  const all = new Set<(event: T) => void>();
  return {
    listen: (listener) => {
      all.add(listener);
      return { dispose: () => all.delete(listener) };
    },
    fire: (event) => {
      for (const listener of [...all]) listener(event);
    },
  };
}

export function outsideSignals() {
  const windowState = listeners<vscode.WindowState>();
  const shellEnd = listeners<vscode.TerminalShellExecutionEndEvent>();
  return {
    window: {
      onDidChangeWindowState: windowState.listen,
      onDidEndTerminalShellExecution: shellEnd.listen,
    },
    focus: (focused = true) => windowState.fire({ focused, active: focused }),
    // A command line ended in an integrated terminal; its terminal and shell
    // integration are no part of what the account reads.
    ended: (commandLine: string) =>
      shellEnd.fire({
        execution: { commandLine: { value: commandLine, isTrusted: true, confidence: 2 } },
      } as unknown as vscode.TerminalShellExecutionEndEvent),
  };
}

export const signedInAs = (id: string) => ({
  organization: null,
  user: { id, email: `${id}@example.com`, name: id },
});
