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
  type JsonOf,
  type LaceReason,
} from '@lace-cloud/canvas/engine';

export type CommandOutcome<P extends BoundPath> =
  | { kind: 'result'; document: JsonOf<P>; exitCode: number }
  | { kind: 'failure'; failure: CommandFailure };

// Runs `path` to its exit and reads its outcome. Rejects with the command's
// own `CommandExitError` when it exited non-zero with neither document, and
// with `CommandDetachedError` when `signal` aborted it.
export async function commandOutcome<P extends BoundPath>(
  commands: Pick<CommandsPort, 'invoke'>,
  path: P,
  args: ArgsOf<P>,
  signal: AbortSignal = new AbortController().signal,
): Promise<CommandOutcome<P>> {
  let last: { document: JsonOf<P> } | null = null;
  try {
    for await (const document of commands.invoke(path, args, signal).events) last = { document };
  } catch (error) {
    if (!(error instanceof CommandExitError)) throw error;
    if (error.failure) return { kind: 'failure', failure: error.failure };
    if (last) return { kind: 'result', document: last.document, exitCode: error.code };
    throw error;
  }
  if (!last) throw new Error(`lace ${path} exited without a document`);
  return { kind: 'result', document: last.document, exitCode: 0 };
}

// A command that ended on its failure document.
export class CommandFailedError extends Error {
  constructor(
    readonly path: BoundPath,
    readonly failure: CommandFailure,
  ) {
    super(failure.message);
  }
}

// The document of `path`'s outcome, for a caller that goes on only with it.
// Throws `CommandFailedError` when the command ended on its failure
// document.
export function documentOf<P extends BoundPath>(path: P, outcome: CommandOutcome<P>): JsonOf<P> {
  if (outcome.kind === 'failure') throw new CommandFailedError(path, outcome.failure);
  return outcome.document;
}

// The document a command's outcome is, for a caller that goes on only with
// it. Rejects with `CommandFailedError` when the command ended on its
// failure document, and as `commandOutcome` does otherwise.
export async function commandDocument<P extends BoundPath>(
  commands: Pick<CommandsPort, 'invoke'>,
  path: P,
  args: ArgsOf<P>,
  signal?: AbortSignal,
): Promise<JsonOf<P>> {
  return documentOf(path, await commandOutcome(commands, path, args, signal));
}

// Why a command failed, as data, when it said.
export function failureOf(error: unknown): CommandFailure | undefined {
  if (error instanceof CommandFailedError || error instanceof CommandExitError) {
    return error.failure;
  }
  return undefined;
}

// What a failed command says, for a person: its failure document's message,
// else the CLI's own text when it ran to an exit, else the error's message.
export function failureText(error: unknown): string {
  const failure = failureOf(error);
  if (failure) return failure.message;
  if (error instanceof CommandExitError) return error.stderrTail.trim();
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
