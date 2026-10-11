// A command line in the syntax of the shell a terminal runs, for a line the
// extension types into a terminal and leaves for the developer to finish
// and run. VS Code types text into a terminal as it is given, and its API
// offers no way to put a command on the prompt unsent in the shell's own
// syntax (`shellIntegration.executeCommand` runs it at once), so the one
// rule that depends on the shell lives here: how a program named by its
// path is called. A terminal opened with no shell named runs the default
// profile, whose shell `vscode.env.shell` names.
//
//   PowerShell (`pwsh`, `powershell`)  & 'path' args   a quoted path runs only
//                                                       through the call
//                                                       operator; each single
//                                                       quote (' ‘ ’ ‚ ‛) is
//                                                       doubled
//   Command Prompt (`cmd`)             "path" args     a Windows path holds
//                                                       no "
//   fish                               'path' args     \ and ' are escaped
//                                                       with \ inside the
//                                                       quotes
//   nushell (`nu`)                     ^'path' args    the caret runs a string
//                                                       as an external program;
//                                                       a path holding ' is a
//                                                       raw string, r#'path'#
//   any other shell (sh, bash, zsh,    'path' args     POSIX single quotes;
//   dash, Git Bash)                                     ' is written '\''
//
// The arguments are words every shell reads alike, given as written. With
// WSL as the default profile, `env.shell` is `wsl.exe`, which names neither
// the distribution's shell nor where it mounts the Windows path a setting
// names: the line is written for a POSIX shell, and may not run there.

type Calling = (program: string) => string;

const POWERSHELL: Calling = (program) => `& '${program.replace(/['‘’‚‛]/g, '$&$&')}'`;
const COMMAND_PROMPT: Calling = (program) => `"${program}"`;
const FISH: Calling = (program) => `'${program.replace(/[\\']/g, '\\$&')}'`;
const NUSHELL: Calling = (program) => {
  if (!program.includes("'")) return `^'${program}'`;
  // A raw string closes at a ' followed by its own number of #: one more
  // than the path holds after any '.
  const runs = [...program.matchAll(/'(#*)/g)].map(([, hashes]) => hashes.length);
  const hashes = '#'.repeat(Math.max(...runs) + 1);
  return `^r${hashes}'${program}'${hashes}`;
};
const POSIX: Calling = (program) => `'${program.replace(/'/g, `'\\''`)}'`;

// The shells that call a quoted path otherwise than POSIX shells do, by the
// name of their executable.
const CALLING: Readonly<Record<string, Calling>> = {
  pwsh: POWERSHELL,
  powershell: POWERSHELL,
  cmd: COMMAND_PROMPT,
  fish: FISH,
  nu: NUSHELL,
};

// The executable's name, without its directory or `.exe`, in either
// platform's spelling of a path.
const nameOf = (shell: string): string =>
  (shell.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '');

// `program` called with `args` in the syntax of `shell`, the path of the
// shell's executable.
export function shellLine(shell: string, program: string, args: string): string {
  return `${(CALLING[nameOf(shell)] ?? POSIX)(program)} ${args}`;
}
