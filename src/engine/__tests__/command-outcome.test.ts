import {
  CommandDetachedError,
  CommandExitError,
  type CommandFailure,
} from '@lace-cloud/canvas/engine';
import { describe, expect, test } from 'vitest';
import {
  type ByReason,
  byReason,
  CommandFailedError,
  commandDocument,
  commandOutcome,
  failureOf,
  failureText,
} from '../command-outcome';
import { fakeCommands } from './fake-commands';

// A commands port whose `module scan` writes `documents`, then ends as
// `fails` says.
const commandsYielding = (documents: unknown[], fails?: Error) =>
  fakeCommands({ 'module scan': { documents, fails } }).port;

const SCAN = { treeHash: 'h', diagnostics: [] };
const NO_TOOL: CommandFailure = {
  reason: 'tool_missing',
  message: 'tfsec is not installed',
  tool: 'tfsec',
  url: 'https://example.com/tfsec',
};

describe('a command outcome', () => {
  test('is the document of a command that exited 0', async () => {
    expect(await commandOutcome(commandsYielding([SCAN]), 'module scan', {})).toEqual({
      kind: 'result',
      document: SCAN,
      exitCode: 0,
    });
  });

  test('is the document of a command that rendered it and exited non-zero', async () => {
    const outcome = await commandOutcome(
      commandsYielding([SCAN], new CommandExitError(1, '')),
      'module scan',
      {},
    );
    expect(outcome).toEqual({ kind: 'result', document: SCAN, exitCode: 1 });
  });

  test('is the failure document of a command that could not render its result', async () => {
    const outcome = await commandOutcome(
      commandsYielding([], new CommandExitError(1, 'tfsec is not installed', NO_TOOL)),
      'module scan',
      {},
    );
    expect(outcome).toEqual({ kind: 'failure', failure: NO_TOOL });
  });

  test('rejects with the exit of a command that wrote neither document', async () => {
    const exit = new CommandExitError(2, 'boom');
    await expect(commandOutcome(commandsYielding([], exit), 'module scan', {})).rejects.toBe(exit);
  });

  test('rejects with a detach', async () => {
    const detached = new CommandDetachedError();
    await expect(
      commandOutcome(commandsYielding([SCAN], detached), 'module scan', {}),
    ).rejects.toBe(detached);
  });
});

describe('a command document', () => {
  test('is the document of a command that rendered it, whatever its exit', async () => {
    expect(await commandDocument(commandsYielding([SCAN]), 'module scan', {})).toEqual(SCAN);
    expect(
      await commandDocument(
        commandsYielding([SCAN], new CommandExitError(1, '')),
        'module scan',
        {},
      ),
    ).toEqual(SCAN);
  });

  test('rejects with the failure document of a command that could not render one', async () => {
    const failed = await commandDocument(
      commandsYielding([], new CommandExitError(1, 'Error: tfsec is not installed\n', NO_TOOL)),
      'module scan',
      {},
    ).catch((error) => error);
    expect(failed).toBeInstanceOf(CommandFailedError);
    expect(failed).toMatchObject({ path: 'module scan', failure: NO_TOOL });
    expect(failureOf(failed)).toEqual(NO_TOOL);
    expect(failureText(failed)).toBe('tfsec is not installed');
  });

  test('rejects with the exit of a command that wrote neither document', async () => {
    const exit = new CommandExitError(2, 'Error: boom\n');
    const failed = await commandDocument(commandsYielding([], exit), 'module scan', {}).catch(
      (error) => error,
    );
    expect(failed).toBe(exit);
    expect(failureOf(failed)).toBeUndefined();
    expect(failureText(failed)).toBe('Error: boom');
  });
});

describe('what a failure says', () => {
  test('a stream that ended on a failure document says it as data and as its message', () => {
    const exit = new CommandExitError(1, 'Error: tfsec is not installed\n', NO_TOOL);
    expect(failureOf(exit)).toEqual(NO_TOOL);
    expect(failureText(exit)).toBe('tfsec is not installed');
  });

  test('any other error says its message and no failure', () => {
    expect(failureOf(new Error('gone'))).toBeUndefined();
    expect(failureText(new Error('gone'))).toBe('gone');
  });
});

describe('a table by reason', () => {
  test('is keyed by Lace’s own reasons, so a misspelt one does not compile, and is read by a failure’s reason', () => {
    // @ts-expect-error `no_certfication` is no reason of Lace's.
    const misspelt: ByReason<string> = { no_certfication: 'Validate' };
    expect(misspelt).toBeDefined();

    const table: ByReason<string> = { no_certification: 'Validate' };
    expect(byReason(table, 'no_certification')).toBe('Validate');
    expect(byReason(table, 'stale_certification')).toBeUndefined();
    // An API code, and a name every object has, are no entry.
    expect(byReason(table, 'not_found')).toBeUndefined();
    expect(byReason(table, 'toString')).toBeUndefined();
  });
});
