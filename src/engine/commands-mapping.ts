// The commands mapping, host-side: a `commands` port over the engine that
// opens no session. Every command it runs names one working directory, as a
// terminal invocation has one — the authoring root for a command that reads
// a module's directory, the developer's home for a command that reads none.
// The engine picks the Workspace: the root's open session's when it has one,
// the directory on disk otherwise.
//
// One port per engine and working directory: asked again while the same
// engine runs, the mapping hands back the port it opened, so a holder can
// tell a restarted engine by a new port.
import { homedir } from 'node:os';
import {
  type BridgeEngineCaller,
  type CommandsPort,
  openEngineCommands,
} from '@lace-cloud/canvas/engine';

export type CommandsMapping = {
  // For a command that reads the module directory `root`.
  at: (root: string) => Promise<CommandsPort>;
  // For a command that reads no directory.
  anywhere: () => Promise<CommandsPort>;
};

export function createCommandsMapping(
  engine: { caller: () => Promise<BridgeEngineCaller> },
  home: string = homedir(),
): CommandsMapping {
  const opened = new WeakMap<BridgeEngineCaller, Map<string, Promise<CommandsPort>>>();
  const at = async (cwd: string): Promise<CommandsPort> => {
    const caller = await engine.caller();
    const ports = opened.get(caller) ?? new Map<string, Promise<CommandsPort>>();
    opened.set(caller, ports);
    const port = ports.get(cwd) ?? openEngineCommands(caller, { cwd });
    ports.set(cwd, port);
    // A port the engine refused is asked for again next time.
    port.catch(() => ports.delete(cwd));
    return port;
  };
  return { at, anywhere: () => at(home) };
}
