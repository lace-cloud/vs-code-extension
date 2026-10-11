// A commands mapping, and its port in the developer's home, whose commands
// a test scripts per path: the documents a command writes, each read
// through its path's schema as the engine's port reads it, then a clean end
// or the error it fails with; or a command held until the test finishes it,
// or until the signal it was invoked with aborts, which detaches it as the
// engine's port detaches an Invoke whose stream is aborted.
// A script may be a function of the command's arguments, answered now or
// later. Every invocation is recorded with the directory it ran in: the one
// it names, else the port's own.
import {
  type ArgsOf,
  type BoundPath,
  CommandDetachedError,
  CommandExitError,
  type CommandFailure,
  type CommandsPort,
  type Invocation,
  parseBound,
} from '@lace-cloud/canvas/engine';
import type { CommandsMapping } from '../commands-mapping';

export const HOME = '/home/dev';

export type Script = { documents?: readonly unknown[]; fails?: Error } | { held: true };

export type Scripts = Partial<
  Record<BoundPath, Script | ((args: Record<string, unknown>) => Script | Promise<Script>)>
>;

// The end of a command that could not render its result, as the CLI ends
// it: its message on stderr and its failure document, with exit 1.
export function refused(failure: CommandFailure, code = 1): Script {
  return { fails: new CommandExitError(code, `Error: ${failure.message}\n`, failure) };
}

export type Invoked = { cwd: string; path: BoundPath; args: Record<string, unknown> };

// A held command: it writes nothing until the test finishes it.
export type Held = {
  path: BoundPath;
  // How many times its invocation was cancelled.
  cancelled: number;
  finish: (documents: readonly unknown[], fails?: Error) => void;
};

export function fakeCommands(scripts: Scripts) {
  const invoked: Invoked[] = [];
  const held: Held[] = [];

  function hold(path: BoundPath, signal: AbortSignal): { entry: Held; finished: Promise<Script> } {
    let finish: Held['finish'] = () => {};
    const finished = new Promise<Script>((resolve, reject) => {
      finish = (documents, fails) => resolve({ documents, fails });
      const detach = () => reject(new CommandDetachedError());
      if (signal.aborted) detach();
      else signal.addEventListener('abort', detach, { once: true });
    });
    // A detach is the events' to throw; one never iterated is no failure.
    finished.catch(() => {});
    const entry: Held = { path, cancelled: 0, finish: (...end) => finish(...end) };
    held.push(entry);
    return { entry, finished };
  }

  const portIn = (cwd: string): CommandsPort => ({
    available: () => new Set(Object.keys(scripts) as BoundPath[]),
    invoke<P extends BoundPath>(
      path: P,
      args: ArgsOf<P>,
      signal: AbortSignal,
      directory?: string,
    ): Invocation<P> {
      const given = args as Record<string, unknown>;
      invoked.push({ cwd: directory ?? cwd, path, args: given });
      const scripted: NonNullable<Scripts[BoundPath]> = scripts[path] ?? { documents: [] };
      const script: Script | Promise<Script> =
        typeof scripted === 'function' ? scripted(given) : scripted;
      const holding = !(script instanceof Promise) && 'held' in script ? hold(path, signal) : null;
      async function* events() {
        const answered: Script = holding ? await holding.finished : await script;
        if ('held' in answered) throw new Error(`a held answer for ${path} is not finished`);
        for (const document of answered.documents ?? []) {
          if (signal.aborted) throw new CommandDetachedError();
          yield parseBound(path, document);
        }
        if (answered.fails) throw answered.fails;
      }
      return {
        events: events(),
        cancel: async () => {
          if (holding) holding.entry.cancelled += 1;
        },
      };
    },
  });

  const port = portIn(HOME);
  const commands: CommandsMapping = {
    at: async (cwd) => portIn(cwd),
    anywhere: async () => port,
  };
  return { port, commands, invoked, held, paths: () => invoked.map((call) => call.path) };
}
