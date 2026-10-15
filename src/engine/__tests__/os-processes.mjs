// What the engine tests ask the OS about processes, asked the way that OS
// answers: the processes a process started, and a Node script made into a
// program the OS runs, as an engine binary is run. Windows lists processes
// through PowerShell and starts only an executable, so the script runs from
// a launcher `.exe`; elsewhere `ps` lists them and the script runs by its
// `#!` line.
import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const powershell = (command) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
  });

// `text` as a PowerShell string literal.
const literal = (text) => `'${text.replaceAll("'", "''")}'`;

// A console program that runs `node` on `script` with the arguments it is
// given, each quoted, on its own standard streams, and exits as that run
// exits. The engine's arguments hold no quote.
const launcher = (node, script) => `using System.Diagnostics;

public static class Launcher {
  public static int Main(string[] args) {
    string[] quoted = new string[args.Length + 1];
    quoted[0] = Quote(${JSON.stringify(script)});
    for (int i = 0; i < args.Length; i++) quoted[i + 1] = Quote(args[i]);
    ProcessStartInfo start = new ProcessStartInfo(${JSON.stringify(node)}, string.Join(" ", quoted));
    start.UseShellExecute = false;
    using (Process run = Process.Start(start)) {
      run.WaitForExit();
      return run.ExitCode;
    }
  }

  static string Quote(string arg) {
    return "\\"" + arg + "\\"";
  }
}
`;

const windows = {
  // Every process, a line each: its id, its parent's id, its command line.
  processTable: () =>
    powershell(
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine }",
    ),
  // `<name>.js`, and `<name>.exe` that runs it with this Node, compiled by
  // Windows PowerShell's C# compiler.
  nodeProgram(directory, name, script) {
    const source = join(directory, `${name}.js`);
    const code = join(directory, `${name}.cs`);
    const program = join(directory, `${name}.exe`);
    writeFileSync(source, script);
    writeFileSync(code, launcher(process.execPath, source));
    powershell(
      `Add-Type -Path ${literal(code)} -OutputAssembly ${literal(program)} -OutputType ConsoleApplication`,
    );
    return program;
  },
};

const posix = {
  processTable: () =>
    execFileSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'args='], { encoding: 'utf8' }),
  nodeProgram(directory, name, script) {
    const program = join(directory, name);
    writeFileSync(program, `#!/usr/bin/env node\n${script}`);
    chmodSync(program, 0o755);
    return program;
  },
};

const os = process.platform === 'win32' ? windows : posix;

// The processes `pid` started, each with its command line.
export function childProcesses(pid) {
  return os
    .processTable()
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s*(.*)$/))
    .filter((row) => row !== null && Number(row[2]) === pid)
    .map(([, child, , command]) => ({ pid: Number(child), command }));
}

// `script`, Node's source, as a program named `name` in `directory` that the
// OS runs; the path to spawn it by.
export function nodeProgram(directory, name, script) {
  return os.nodeProgram(directory, name, script);
}
