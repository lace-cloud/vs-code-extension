import type { ActionContribution, CommandFailure, LaceReason } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import type { Noticed } from '../../engine/runner-host';
import { notice, type OfferActions, offeringPresenter, offersFor } from '../offers';
import { type Button, clicked, shownBy } from './fake-messages';

const STACK = { id: 'stk_1', slug: 'prod' };
const CERTIFICATION: CommandFailure = {
  reason: 'no_certification',
  message: 'no certification',
};

const actions = (): OfferActions => ({
  signIn: vi.fn(),
  selectOrganization: vi.fn(),
  selectTeam: vi.fn(),
  openPortal: vi.fn(),
  install: vi.fn(),
  openRecord: vi.fn(),
});

// A window whose boxes click the button titled `answer`.
const window = (answer?: string) => {
  const box = () => vi.fn(async (_text: string, ...buttons: Button[]) => clicked(buttons, answer));
  return { showErrorMessage: box(), showWarningMessage: box(), showInformationMessage: box() };
};

describe('the ways out of a failure', () => {
  test('are read from its reason, and the page to open from the URL it carries', () => {
    const failure = (reason: LaceReason, url?: string) => ({ reason, message: 'text', url });
    expect(offersFor(undefined)).toEqual([]);
    expect(offersFor(failure('unauthenticated'))).toEqual([{ kind: 'signIn' }]);
    expect(offersFor(failure('no_organization'))).toEqual([{ kind: 'selectOrganization' }]);
    expect(offersFor(failure('no_team', 'https://portal/teams/new'))).toEqual([
      { kind: 'selectTeam' },
      { kind: 'openPortal', url: 'https://portal/teams/new' },
    ]);
    expect(offersFor(failure('no_certification'))).toEqual([{ kind: 'validate' }]);
    expect(offersFor(failure('stale_certification'))).toEqual([{ kind: 'validate' }]);
    expect(offersFor(failure('source_refused'))).toEqual([{ kind: 'validate' }]);
    expect(offersFor(failure('not_git_repository'))).toEqual([]);
    expect(offersFor(failure('tool_missing', 'https://terraform-docs.io'))).toEqual([
      { kind: 'install', url: 'https://terraform-docs.io' },
    ]);
    expect(offersFor(failure('tool_missing'))).toEqual([]);
    expect(offersFor(failure('unspecified'))).toEqual([]);
    expect(offersFor({ ...failure('unspecified'), apiCode: 'not_found' })).toEqual([]);
  });

  test('a notice shows them at its level, then its own buttons, and the offer chosen runs', async () => {
    const shown = window('Open Portal');
    const act = actions();
    const answer = await notice(
      { window: shown } as never,
      act,
      'error',
      'no team',
      offersFor({ reason: 'no_team', message: 'no team', url: 'https://portal/teams/new' }),
      [{ title: 'Show Output' }],
    );
    expect(shownBy(shown.showErrorMessage)).toEqual([
      ['no team', 'Select Team', 'Open Portal', 'Show Output'],
    ]);
    expect(answer).toBeUndefined();
    expect(act.openPortal).toHaveBeenCalledWith({
      kind: 'openPortal',
      url: 'https://portal/teams/new',
    });
    expect(act.selectTeam).not.toHaveBeenCalled();
  });

  test('Validate is offered only by a notice that names its root, and validates that root', async () => {
    const failure: CommandFailure = { reason: 'no_certification', message: 'no certification' };
    const unnamed = window('Validate');
    await notice(
      { window: unnamed } as never,
      actions(),
      'error',
      'no certification',
      offersFor(failure),
    );
    expect(shownBy(unnamed.showErrorMessage)).toEqual([['no certification']]);

    const named = window('Validate');
    const validate = vi.fn();
    await notice(
      { window: named } as never,
      { ...actions(), validate },
      'error',
      'no certification',
      offersFor(failure),
    );
    expect(shownBy(named.showErrorMessage)).toEqual([['no certification', 'Validate']]);
    expect(validate).toHaveBeenCalledWith({ kind: 'validate' });
  });

  test("one click is one choice: a button of the notice's own titled as an offer runs no offer", async () => {
    const shown = window();
    const act = actions();
    const own = { title: 'Sign In' };
    shown.showErrorMessage.mockImplementation(async (_text, ...buttons) => buttons.at(-1));
    const answer = await notice(
      { window: shown } as never,
      act,
      'error',
      'sign in first',
      offersFor({ reason: 'unauthenticated', message: 'sign in first' }),
      [own],
    );
    expect(shownBy(shown.showErrorMessage)).toEqual([['sign in first', 'Sign In', 'Sign In']]);
    expect(answer).toBe(own);
    expect(act.signIn).not.toHaveBeenCalled();
  });
});

describe("a change request's records", () => {
  test('are offered by the record each opens, and the one chosen opens its page', async () => {
    const shown = window('Open jsm CHG-7');
    const act = actions();
    const page = { kind: 'openRecord', record: 'jsm CHG-7', url: 'https://jsm/CHG-7' } as const;
    const answer = await notice(
      { window: shown } as never,
      act,
      'info',
      'awaits approval',
      [{ kind: 'openRecord', record: 'snow CHG-1', url: 'https://snow/CHG-1' }, page],
      [{ title: 'Show Output' }],
    );
    expect(shownBy(shown.showInformationMessage)).toEqual([
      ['awaits approval', 'Open snow CHG-1', 'Open jsm CHG-7', 'Show Output'],
    ]);
    expect(answer).toBeUndefined();
    expect(act.openRecord).toHaveBeenCalledOnce();
    expect(act.openRecord).toHaveBeenCalledWith(page);
  });
});

describe("the presenter of the window's runner", () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
  const repo = {
    uri: { scheme: 'file', path: '/work/repo', fsPath: '/work/repo' },
    name: 'repo',
    index: 0,
  };

  // The presenter over `shown`, telling it `noticed`, with the runner's run
  // and each progress notification recorded: its title, and whether its
  // task has ended.
  function presenter(shown: ReturnType<typeof window>, noticed: () => Noticed | undefined) {
    const validate = vi.fn(async () => {});
    const run = vi.fn(async () => ({ ended: Promise.resolve() }));
    const progress: { title?: string; ended: boolean }[] = [];
    const withProgress = vi.fn(async (opened: { title?: string }, task: () => Promise<unknown>) => {
      const entry = { title: opened.title, ended: false };
      progress.push(entry);
      await task();
      entry.ended = true;
    });
    const made = offeringPresenter({
      api: {
        window: { ...shown, withProgress },
        workspace: { workspaceFolders: [repo] },
        ProgressLocation: { Notification: 15 },
      } as never,
      actions: actions(),
      confirm: vi.fn(),
      validate,
      sources: { folders: () => [repo as never] },
      report: vi.fn(),
    })({ run, noticed });
    return { made, validate, run, progress };
  }

  test("offers, after the failure's ways out, the package actions that answer it, and runs the one chosen", async () => {
    const failure: CommandFailure = {
      reason: 'no_team',
      message: 'No team is selected',
      url: 'https://portal/teams/new',
    };
    const shown = window('Answer');
    const ctx = { stack: STACK };
    const answer = { action: { label: 'Answer' } as ActionContribution, ctx, target: { failure } };
    const answers = vi.fn(() => [answer]);
    const { made, run, progress } = presenter(shown, () => ({ ctx, answers }));

    made.notify('error', 'No team is selected', failure);
    await settled();
    expect(answers).toHaveBeenCalledWith(failure);
    expect(shownBy(shown.showErrorMessage)).toEqual([
      ['No team is selected', 'Select Team', 'Open Portal', 'Answer'],
    ]);
    expect(run).toHaveBeenCalledWith(answer.action, ctx, { failure });
    expect(progress).toEqual([{ title: 'Answer: prod', ended: true }]);
  });

  test('a failure of a run whose RunCtx names a root offers Validate on that root, which the one chosen validates', async () => {
    const shown = window('Validate');
    const { made, validate } = presenter(shown, () => ({
      ctx: { root: '/work/repo/infra/prod', stack: STACK },
      answers: () => [],
    }));

    made.notify('error', 'no certification', CERTIFICATION);
    await settled();
    expect(shownBy(shown.showErrorMessage)).toEqual([['no certification', 'Validate']]);
    expect(validate).toHaveBeenCalledWith({ folder: repo, relative: 'infra/prod' });
  });

  test.each([
    ['names no root', { stack: STACK }],
    ['names a root under no workspace folder', { root: '/elsewhere/infra', stack: STACK }],
  ])('a failure of a run whose RunCtx %s offers no Validate', async (_why, ctx) => {
    const shown = window('Validate');
    const { made, validate } = presenter(shown, () => ({ ctx, answers: () => [] }));

    made.notify('error', 'no certification', CERTIFICATION);
    await settled();
    expect(shownBy(shown.showErrorMessage)).toEqual([['no certification']]);
    expect(validate).not.toHaveBeenCalled();
  });

  test('a package action titled as an offer runs alone when its own button is clicked', async () => {
    const shown = window();
    shown.showErrorMessage.mockImplementation(async (_text, ...buttons) => buttons.at(-1));
    const ctx = { root: '/work/repo/infra/prod', stack: STACK };
    const answer = {
      action: { label: 'Validate' } as ActionContribution,
      ctx,
      target: { failure: CERTIFICATION },
    };
    const { made, validate, run } = presenter(shown, () => ({ ctx, answers: () => [answer] }));

    made.notify('error', 'no certification', CERTIFICATION);
    await settled();
    expect(shownBy(shown.showErrorMessage)).toEqual([['no certification', 'Validate', 'Validate']]);
    expect(run).toHaveBeenCalledWith(answer.action, ctx, { failure: CERTIFICATION });
    expect(validate).not.toHaveBeenCalled();
  });

  test('asks for no answer of a notice that carries no failure', async () => {
    const shown = window();
    const answers = vi.fn(() => []);
    const { made } = presenter(shown, () => ({ ctx: { stack: STACK }, answers }));

    made.notify('info', 'Created stack prod');
    await settled();
    expect(answers).not.toHaveBeenCalled();
    expect(shown.showInformationMessage).toHaveBeenCalledWith('Created stack prod');
  });
});
