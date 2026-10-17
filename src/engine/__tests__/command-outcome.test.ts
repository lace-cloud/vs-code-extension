import {
  CommandDetachedError,
  CommandExitError,
  type CommandFailure,
  CommandUnobservedError,
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

// A commands port whose `module scan`, `module docs` and `module fmt` each
// write `documents`, then end as `fails` says.
const commandsYielding = (documents: unknown[], fails?: Error) =>
  fakeCommands({
    'module scan': { documents, fails },
    'module docs': { documents, fails },
    'module fmt': { documents, fails },
  }).port;

const SCAN = {
  treeHash: 'h',
  tool: { name: 'tfsec', version: 'v1.28.13', path: '/home/dev/.lace/bin/tfsec', source: 'cache' },
  diagnostics: [],
};
const NO_TOOL: CommandFailure = {
  reason: 'tool_missing',
  message: 'tfsec is not installed',
  tool: 'tfsec',
  url: 'https://example.com/tfsec',
};

// What `path` rejects with when it writes no document and fails with
// `fails`.
const rejection = (path: 'module scan' | 'module docs' | 'module fmt', fails: Error) =>
  commandOutcome(commandsYielding([], fails), path, {}).catch((error: unknown) => error);

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

  test('rejects a command that wrote neither document, saying what it wrote on stderr', async () => {
    const failed = await rejection('module scan', new CommandExitError(2, 'Error: boom\n'));
    expect(failed).toBeInstanceOf(CommandFailedError);
    expect(failureText(failed)).toBe('Error: boom');
    expect(failureOf(failed)).toBeUndefined();
  });

  test('rejects a command that exited 0 without a document, naming the command', async () => {
    const failed = await commandOutcome(commandsYielding([]), 'module scan', {}).catch(
      (error: unknown) => error,
    );
    expect(failed).toBeInstanceOf(CommandFailedError);
    expect(failureText(failed)).toBe('lace module scan exited without a document');
  });

  test('rejects a detached command, saying the detach', async () => {
    const detached = new CommandDetachedError();
    const failed = await rejection('module fmt', detached);
    expect(failed).toBeInstanceOf(CommandFailedError);
    expect(failureText(failed)).toBe(detached.message);
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

  test('rejects a command that could not render one, saying its failure document and never its stderr', async () => {
    const failed = await commandDocument(
      commandsYielding(
        [],
        new CommandExitError(1, 'Provider mirror: none\nError: tfsec is not installed\n', NO_TOOL),
      ),
      'module scan',
      {},
    ).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(CommandFailedError);
    expect(failureOf(failed)).toEqual(NO_TOOL);
    expect(failureText(failed)).toBe('tfsec is not installed');
  });
});

describe('what a failure says', () => {
  test('a read whose stream ended before its exit says to run it again; a write or a rewrite, that it ran and may have made changes, as the CLI declares the command', async () => {
    expect(
      failureText(await rejection('module scan', new CommandUnobservedError('module scan'))),
    ).toBe("the engine's stream ended before `lace module scan` exited; run it again");
    expect(
      failureText(await rejection('module docs', new CommandUnobservedError('module docs'))),
    ).toBe(
      "the engine's stream ended before `lace module docs` exited: it ran and may have made changes, but its outcome is unknown",
    );
    expect(
      failureText(await rejection('module fmt', new CommandUnobservedError('module fmt'))),
    ).toBe(
      "the engine's stream ended before `lace module fmt` exited: it ran and may have made changes, but its outcome is unknown",
    );
  });

  test('an error that is no command’s failure says its message and no failure', () => {
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
