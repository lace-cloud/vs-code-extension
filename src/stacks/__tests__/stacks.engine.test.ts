// The window's runner and the Stacks tree's reads on the real engine, the
// `lace` CLI in bin/ or on PATH (`real-engine.ts`), signed out and with no
// organization selected: a developer home of the test's own.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_COMMAND_ACTIONS, type CommandFailure, type RunSlot } from '@lace-cloud/canvas/engine';
import { describe, expect, test } from 'vitest';
import {
  afterTest,
  gitRepository,
  moduleIn,
  realEngine,
  signedOutHome,
} from '../../engine/__tests__/real-engine';
import { commandDocument, commandOutcome } from '../../engine/command-outcome';
import { createRunnerHost } from '../../engine/runner-host';
import { refusedState } from '../stack-rows';

// A git repository with two module directories.
function twoRoots(): { a: string; b: string } {
  const repository = gitRepository();
  return { a: moduleIn(repository, 'a'), b: moduleIn(repository, 'b') };
}

// The window's commands mapping, for a developer whose home is `home`, and
// its one runner.
function window(home: string) {
  const { commands } = realEngine({ home });
  const notices: { level: string; failure?: CommandFailure }[] = [];
  const runner = createRunnerHost({
    commands: () => commands.anywhere(),
    presenter: { notify: (level, _text, failure) => notices.push({ level, failure }) },
    onRunLog: () => {},
  });
  afterTest(() => runner.dispose());
  return { commands, runner, notices };
}

const binding = (id: string) => {
  const found = CORE_COMMAND_ACTIONS.find((action) => action.id === id);
  if (!found) throw new Error(`no binding ${id}`);
  return found;
};

// The run slot once it settles.
function settledRun(runner: ReturnType<typeof createRunnerHost>): Promise<NonNullable<RunSlot>> {
  return new Promise((resolveRun) => {
    const check = () => {
      const { run } = runner.store.getSnapshot();
      if (run && run.outcome.kind !== 'running') {
        off();
        resolveRun(run);
      }
    };
    const off = runner.store.subscribe(check);
    check();
  });
}

const reasonOf = (run: NonNullable<RunSlot>): string | undefined =>
  run.outcome.kind === 'failed' || run.outcome.kind === 'blocked'
    ? run.outcome.failure?.reason
    : undefined;

describe('one runner for the window', () => {
  test('an apply runs in the root its RunCtx names, whichever root ran before, and opens no session', async () => {
    const home = signedOutHome();
    const { a, b } = twoRoots();
    const { commands, runner } = window(home);
    // `a` is certified; `b` is not.
    await commandDocument(await commands.at(a), 'module validate', {});

    await runner.run(binding('apply'), { root: a, stack: { id: 'stk_a', slug: 'a' } });
    // Past `a`'s certification, the apply needs credentials, which are
    // checked before the organization and team.
    expect(reasonOf(await settledRun(runner))).toBe('unauthenticated');

    await runner.run(binding('apply'), { root: b, stack: { id: 'stk_b', slug: 'b' } });
    expect(reasonOf(await settledRun(runner))).toBe('no_certification');

    for (const root of [a, b]) expect(existsSync(join(root, '.lace', '.canvas'))).toBe(false);
  });
});

describe('the Stacks tree signed out', () => {
  test('stack list names unauthenticated before any missing selection, and the view offers Sign In', async () => {
    const home = signedOutHome();
    const { a } = twoRoots();
    const { commands } = window(home);
    const listed = await commandOutcome(await commands.anywhere(), 'stack list', { source: a });
    const failure = listed.kind === 'failure' ? listed.failure : undefined;
    expect(failure?.reason).toBe('unauthenticated');
    expect(refusedState(failure)).toBe('signedOut');
  });
});
