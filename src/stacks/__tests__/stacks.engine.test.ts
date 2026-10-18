// The window's runner and the Stacks tree's reads on the real engine, the
// `lace` CLI in bin/ or on PATH (`real-engine.ts`), signed out and with no
// organization selected: a developer home of the test's own.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandFailure, RunSlot } from '@lace-cloud/canvas/engine';
import { describe, expect, test } from 'vitest';
import {
  afterTest,
  gitRepository,
  moduleIn,
  realEngine,
  scratchDirectory,
  until,
} from '../../engine/__tests__/real-engine';
import { commandDocument, commandOutcome } from '../../engine/command-outcome';
import { type Answerer, binding, createRunnerHost } from '../../engine/runner-host';
import { refusedState } from '../stack-rows';

// A git repository with two module directories.
function twoRoots(): { a: string; b: string } {
  const repository = gitRepository();
  return { a: moduleIn(repository, 'a'), b: moduleIn(repository, 'b') };
}

// The window's commands mapping, for the test's developer, and its one
// runner, whose forms `answerer` answers.
function window(answerer: Answerer = (form) => form.cancel()) {
  const { commands } = realEngine();
  const notices: { level: string; failure?: CommandFailure }[] = [];
  const runner = createRunnerHost({
    commands: () => commands.anywhere(),
    presenter: () => ({ notify: (level, _text, failure) => notices.push({ level, failure }) }),
    answerer,
    onRunLog: () => {},
  });
  afterTest(() => runner.dispose());
  return { commands, runner, notices };
}

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
    const { a, b } = twoRoots();
    const { commands, runner } = window();
    // `a` is certified and locked, as a developer readies a module to apply
    // (an apply refuses a root with no `.terraform.lock.hcl` before it reads
    // any credential); `b` is neither. The module calls no provider, so its
    // lock pins none and reaches no network.
    await commandDocument(await commands.at(a), 'module validate', {});
    await commandDocument(await commands.at(a), 'module lock', {});

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
    const { a } = twoRoots();
    const { commands } = window();
    const listed = await commandOutcome(await commands.anywhere(), 'stack list', { source: a });
    const failure = listed.kind === 'failure' ? listed.failure : undefined;
    expect(failure?.reason).toBe('unauthenticated');
    expect(refusedState(failure)).toBe('signedOut');
  });
});

describe("a binding's form answered over the real engine", () => {
  test("Create Stack's slug and connection reach stack create in the root, whose refusal is the CLI's by its reason, and the run ends", async () => {
    const { a } = twoRoots();
    const { runner, notices } = window((form) =>
      form.submit({ slug: 'prod', connection: 'conn_1' }),
    );

    const { ended } = await runner.run(binding('create'), { root: a });
    await ended;
    // A failure is said once its command has ended.
    await until('the refusal is said', () => notices.length > 0);
    // The stack's source binding is the root's repository's `origin`, which
    // this repository has none of.
    expect(notices.map(({ level, failure }) => [level, failure?.reason])).toEqual([
      ['error', 'no_origin_remote'],
    ]);
  });

  test("Import Existing Resources' statefile reaches stack import in the root, which needs credentials, and the run ends", async () => {
    const { a } = twoRoots();
    const state = join(scratchDirectory(), 'pulled.tfstate');
    writeFileSync(
      state,
      JSON.stringify({ version: 4, serial: 1, lineage: 'l', outputs: {}, resources: [] }),
    );
    const { runner, notices } = window((form) => form.submit({ state }));

    const { ended } = await runner.run(binding('import'), {
      root: a,
      stack: { id: 'stk_a', slug: 'a' },
    });
    await ended;
    await until('the refusal is said', () => notices.length > 0);
    expect(notices.map(({ level, failure }) => [level, failure?.reason])).toEqual([
      ['error', 'unauthenticated'],
    ]);
  });
});
