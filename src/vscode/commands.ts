// Command registration: every command of the extension is registered through
// here, so a command that fails says so once, where the developer acted.
import type * as vscode from 'vscode';
import { failureText } from '../engine/command-outcome';

type CommandsApi = {
  commands: Pick<typeof vscode.commands, 'registerCommand'>;
  window: Pick<typeof vscode.window, 'showErrorMessage'>;
};

export type CommandTable = Readonly<Record<string, (...args: never[]) => unknown>>;

export function registerCommands(api: CommandsApi, table: CommandTable): vscode.Disposable[] {
  return Object.entries(table).map(([id, run]) =>
    api.commands.registerCommand(id, async (...args: never[]) => {
      try {
        await run(...args);
      } catch (error) {
        void api.window.showErrorMessage(failureText(error));
      }
    }),
  );
}
