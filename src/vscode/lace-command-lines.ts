// The `lace` command lines that end in the window's integrated terminals, as
// VS Code's shell integration reports them
// (`window.onDidEndTerminalShellExecution`), each read as the CLI command it
// ran. A command run in a terminal changes what the CLI reports as the same
// command run by the window does, and changes no focus: this is how the
// window hears of it. The program is `lace`, named bare or by its path, or
// `lace.exe`; the command is the one its words name, read as the CLI reads
// them (the package's `commandPathOf`), or none when they name no command a
// host can run (`lace`, `lace --help`, `lace help stack apply`, a misspelt
// command).
import { type CommandPath, commandPathOf } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';

// What a `lace` command line ran: the CLI command its words name, if any.
type LaceCommand = { path: CommandPath | undefined };

const LACE_PROGRAM = /^(?:\S*[/\\])?lace(?:\.exe)?$/;

// What `commandLine` ran when it runs `lace`, or undefined when it runs
// another program.
function laceCommandOf(commandLine: string): LaceCommand | undefined {
  const [program = '', ...words] = commandLine.trim().split(/\s+/);
  if (!LACE_PROGRAM.test(program)) return undefined;
  return { path: commandPathOf(words) };
}

// Calls `listener` with what each `lace` command line ran, as it ends in one
// of the window's integrated terminals.
export function onDidEndLaceCommand(
  window: Pick<typeof vscode.window, 'onDidEndTerminalShellExecution'>,
  listener: (ran: LaceCommand) => void,
): vscode.Disposable {
  return window.onDidEndTerminalShellExecution(({ execution }) => {
    const ran = laceCommandOf(execution.commandLine.value);
    if (ran) listener(ran);
  });
}
