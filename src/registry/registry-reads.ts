// The registry reads the sidebar, module detail and Add Module run: each a
// command through the commands mapping in the developer's home, since none
// reads a directory. The module axis only, and up to the most rows one
// `registry list` returns.
import type { BoundPath, JsonOf } from '@lace-cloud/canvas/engine';
import { type CommandOutcome, commandOutcome, failureText } from '../engine/command-outcome';
import type { CommandsMapping } from '../engine/commands-mapping';
import { LACE_COMMANDS } from '../engine/lace-commands';
import type { Read } from '../protocol/registry-protocol';

export const LIST_LIMIT = 500;

// A module's registry reference, as the registry commands take it.
const artifact = (key: string): string => `module/${key}`;

export type RegistryReads = {
  list: () => Promise<CommandOutcome<'registry list'>>;
  get: (key: string) => Promise<CommandOutcome<'registry get'>>;
  describe: (key: string, version: string) => Promise<CommandOutcome<'registry describe'>>;
  // The organization registry reads are scoped to: the CLI's selection.
  organization: () => Promise<CommandOutcome<'org current'>>;
};

export function registryReads(commands: Pick<CommandsMapping, 'anywhere'>): RegistryReads {
  return {
    list: async () =>
      commandOutcome(await commands.anywhere(), LACE_COMMANDS['registry list'], {
        axis: 'module',
        limit: LIST_LIMIT,
      }),
    get: async (key) =>
      commandOutcome(await commands.anywhere(), LACE_COMMANDS['registry get'], {
        artifact: artifact(key),
      }),
    describe: async (key, version) =>
      commandOutcome(await commands.anywhere(), LACE_COMMANDS['registry describe'], {
        artifact: artifact(key),
        version,
      }),
    organization: async () =>
      commandOutcome(await commands.anywhere(), LACE_COMMANDS['org current'], {}),
  };
}

// What a read's outcome draws: its document, or the message of the failure
// it ended with. A read that threw is reported and drawn by its message.
export async function asRead<P extends BoundPath>(
  read: () => Promise<CommandOutcome<P>>,
  report: (error: unknown) => void,
): Promise<Read<JsonOf<P>>> {
  try {
    const outcome = await read();
    return outcome.kind === 'result'
      ? { kind: 'loaded', value: outcome.document }
      : { kind: 'failed', message: outcome.failure.message };
  } catch (error) {
    report(error);
    return { kind: 'failed', message: failureText(error) };
  }
}
