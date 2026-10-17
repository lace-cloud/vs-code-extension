import { describe, expect, test, vi } from 'vitest';
import { binding } from '../../engine/runner-host';
import { folder } from '../../roots/__tests__/fake-uri';
import { rootOfRun } from '../../roots/authoring-roots';
import { runTitle, runUnderProgress } from '../run-progress';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const repo = folder('/work/repo');
const STACK = { id: 'stk_1', slug: 'prod' };

describe("a run's title", () => {
  test.each([
    [
      'the run its target names',
      { root: '/work/repo/infra/prod', stack: STACK },
      { runId: 'run_1' },
      'run-cancel',
      'Cancel: run_1',
    ],
    [
      'the stack it acts on',
      { root: '/work/repo/infra/prod', stack: STACK },
      {},
      'import',
      'Import existing resources: prod',
    ],
    [
      'the root by its name in the workspace',
      { root: '/work/repo/infra/prod' },
      {},
      'create',
      'Create stack: infra/prod',
    ],
    [
      'a root under no workspace folder by its path',
      { root: '/elsewhere/infra' },
      {},
      'create',
      'Create stack: /elsewhere/infra',
    ],
    ['nothing else when the run names none of them', {}, {}, 'create', 'Create stack'],
  ])('names its action and %s', (_what, ctx, target, id, title) => {
    expect(runTitle(binding(id), ctx, target, rootOfRun([repo], ctx), [repo])).toBe(title);
  });
});

describe('a run a trigger starts', () => {
  test('runs over its context and target under a progress notification titled by the run, until the run ends', async () => {
    let end: () => void = () => {};
    const ended = new Promise<void>((resolve) => {
      end = resolve;
    });
    const runner = { run: vi.fn(async () => ({ ended })) };
    const progress: { title?: string; ended: boolean }[] = [];
    const api = {
      window: {
        withProgress: vi.fn(
          async (opened: { title?: string; location: number }, task: () => Promise<unknown>) => {
            const entry = { title: opened.title, ended: false };
            progress.push(entry);
            await task();
            entry.ended = true;
          },
        ),
      },
      workspace: { workspaceFolders: [repo] },
      ProgressLocation: { Notification: 15 },
    };
    const ctx = { root: '/work/repo/infra/prod', stack: STACK };
    const failure = { reason: 'import_residual' as const, message: 'no id' };

    const done = runUnderProgress(api as never, runner, binding('import-partial'), ctx, {
      failure,
    });
    await settled();
    expect(runner.run).toHaveBeenCalledWith(binding('import-partial'), ctx, { failure });
    expect(api.window.withProgress.mock.calls[0][0]).toMatchObject({ location: 15 });
    expect(progress).toEqual([{ title: 'Import the rest: prod', ended: false }]);

    end();
    await done;
    expect(progress).toEqual([{ title: 'Import the rest: prod', ended: true }]);
  });
});
