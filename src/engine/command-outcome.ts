// A command's outcome as the host reads it: the document the command
// rendered, with the exit code it ended on, or the failure document that
// kept it from rendering one. A command can render its result and exit
// non-zero — `module scan` exits 1 when it has findings, `module validate`
// when Terraform found errors — and that is a result; what decides is the
// document, never the exit code.
import {
  type ArgsOf,
  type BoundPath,
  CommandExitError,
  type CommandFailure,
  type CommandsPort,
  type FailedCommand,
  failureSays,
  type JsonOf,
  type LaceReason,
} from '@lace-cloud/canvas/engine';

export type CommandOutcome<P extends BoundPath> =
  | { kind: 'result'; document: JsonOf<P>; exitCode: number }
  | { kind: 'failure'; failure: CommandFailure };

// A command the host runs: its path, and whether it reads or writes, as the
// package names a failed one (`FailedCommand`): a read whose stream ended
// under it is run again, a write may have made changes.
export type LaceCommand<P extends BoundPath = BoundPath> = FailedCommand & { path: P };

// A command that failed, as a caller reads it: `message`, the package's one
// reading of the failure for the command it was (`failureSays`), and
// `failure`, the failure document, when the command wrote one. Every failure
// of a command run through `commandOutcome` rejects with one, so a caller
// that runs several commands says the failure of the one that failed.
export class CommandFailedError extends Error {
  readonly failure: CommandFailure | undefined;

  constructor(said: ReturnType<typeof failureSays>) {
    super(said.message);
    this.failure = said.failure;
  }
}

// Runs `command` to its exit and reads its outcome. Rejects with the
// `CommandFailedError` of `command` when it exited non-zero with neither
// document, exited 0 with none, ended without its exit, or was detached by
// `signal`.
export async function commandOutcome<P extends BoundPath>(
  commands: Pick<CommandsPort, 'invoke'>,
  command: LaceCommand<P>,
  args: ArgsOf<P>,
  signal: AbortSignal = new AbortController().signal,
): Promise<CommandOutcome<P>> {
  let last: { document: JsonOf<P> } | null = null;
  try {
    for await (const document of commands.invoke(command.path, args, signal).events) {
      last = { document };
    }
  } catch (error) {
    if (error instanceof CommandExitError) {
      if (error.failure) return { kind: 'failure', failure: error.failure };
      if (last) return { kind: 'result', document: last.document, exitCode: error.code };
    }
    throw new CommandFailedError(failureSays(error, command));
  }
  if (!last) {
    throw new CommandFailedError({ message: `lace ${command.path} exited without a document` });
  }
  return { kind: 'result', document: last.document, exitCode: 0 };
}

// The document of a command's outcome, for a caller that goes on only with
// it. Throws `CommandFailedError` when the command ended on its failure
// document.
export function documentOf<P extends BoundPath>(outcome: CommandOutcome<P>): JsonOf<P> {
  if (outcome.kind === 'failure') {
    throw new CommandFailedError({ message: outcome.failure.message, failure: outcome.failure });
  }
  return outcome.document;
}

// The document a command's outcome is, for a caller that goes on only with
// it. Rejects as `documentOf` throws and as `commandOutcome` rejects.
export async function commandDocument<P extends BoundPath>(
  commands: Pick<CommandsPort, 'invoke'>,
  command: LaceCommand<P>,
  args: ArgsOf<P>,
  signal?: AbortSignal,
): Promise<JsonOf<P>> {
  return documentOf(await commandOutcome(commands, command, args, signal));
}

// Why a command failed, as data, when it said.
export function failureOf(error: unknown): CommandFailure | undefined {
  return error instanceof CommandFailedError ? error.failure : undefined;
}

// What a failure says, for a person. A command run through `commandOutcome`
// fails with a `CommandFailedError`, whose message is the package's reading
// for the command it was; any other error, such as an engine that did not
// start, is no command's failure and says its own message.
export function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// What the host does about a failure, by the failure's reason. Keyed by
// Lace's own reasons (`LaceReason`), so a misspelt one does not compile; an
// API's code is no reason of Lace's and has a table of its own where one is
// read.
export type ByReason<T> = Readonly<Partial<Record<LaceReason, T>>>;

// The entry `table` has for `reason`, a failure's reason as its document
// spells it; undefined for a reason the table names nothing for.
export function byReason<T>(table: ByReason<T>, reason: string): T | undefined {
  return Object.hasOwn(table, reason) ? table[reason as LaceReason] : undefined;
}
