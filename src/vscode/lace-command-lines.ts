// The `lace` command lines that end in the window's integrated terminals, as
// VS Code's shell integration reports them
// (`window.onDidEndTerminalShellExecution`), each read as the CLI command it
// ran. A command run in a terminal changes what the CLI reports as the same
// command run by the window does, and changes no focus: this is how the
// window hears of it. The program is `lace`, named bare or by its path, or
// `lace.exe`; the command is the path in the CLI's command tree (`COMMANDS`)
// its words name, found past the flags, or none when they name no command the
// CLI has (`lace`, `lace --help`, a misspelt command).
import { COMMANDS, type CommandPath } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';

// What a `lace` command line ran: the CLI command its words name, if any.
type LaceCommand = { path: CommandPath | undefined };

const LACE_PROGRAM = /^(?:\S*[/\\])?lace(?:\.exe)?$/;

const isCommandPath = (words: string): words is CommandPath => Object.hasOwn(COMMANDS, words);

// The longest command path that starts at a word of `words`, from the first
// word that starts one.
function pathIn(words: readonly string[]): CommandPath | undefined {
  for (let start = 0; start < words.length; start += 1) {
    for (let end = words.length; end > start; end -= 1) {
      const candidate = words.slice(start, end).join(' ');
      if (isCommandPath(candidate)) return candidate;
    }
  }
  return undefined;
}

// What `commandLine` ran when it runs `lace`, or undefined when it runs
// another program.
function laceCommandOf(commandLine: string): LaceCommand | undefined {
  const [program = '', ...rest] = commandLine.trim().split(/\s+/);
  if (!LACE_PROGRAM.test(program)) return undefined;
  return { path: pathIn(rest.filter((word) => !word.startsWith('-'))) };
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
