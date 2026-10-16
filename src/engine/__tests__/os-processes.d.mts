// `os-processes.mjs`: the processes `pid` started, each with its command
// line, as the OS lists them.
export function childProcesses(pid: number): { pid: number; command: string }[];

// `os-processes.mjs`: `script`, Node's source, as a program named `name` in
// `directory` that the OS runs; the path to spawn it by.
export function nodeProgram(directory: string, name: string, script: string): string;
