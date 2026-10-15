import type { CommandFailure, LaceReason } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import type { Noticed } from '../../engine/runner-host';
import { notice, type OfferActions, offeringPresenter, offersFor } from '../offers';

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

const window = (answer?: string) => ({
  showErrorMessage: vi.fn(async (_text: string, ..._labels: string[]) => answer),
  showWarningMessage: vi.fn(async () => undefined),
  showInformationMessage: vi.fn(async () => undefined),
});

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

  test('a notice shows them at its level, and the one chosen runs', async () => {
    const shown = window('Open Portal');
    const act = actions();
    const answer = await notice(
      { window: shown } as never,
      act,
      'error',
      'no team',
      offersFor({ reason: 'no_team', message: 'no team', url: 'https://portal/teams/new' }),
      ['Show Output'],
    );
    expect(shown.showErrorMessage).toHaveBeenCalledWith(
      'no team',
      'Select Team',
      'Open Portal',
      'Show Output',
    );
    expect(answer).toBe('Open Portal');
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
    expect(unnamed.showErrorMessage).toHaveBeenCalledWith('no certification');

    const named = window('Validate');
    const validate = vi.fn();
    await notice(
      { window: named } as never,
      { ...actions(), validate },
      'error',
      'no certification',
      offersFor(failure),
    );
    expect(named.showErrorMessage).toHaveBeenCalledWith('no certification', 'Validate');
    expect(validate).toHaveBeenCalledWith({ kind: 'validate' });
  });
});

describe("a change request's records", () => {
  test('are offered by the record each opens, and the one chosen opens its page', async () => {
    const shown = {
      ...window(),
      showInformationMessage: vi.fn(
        async (_text: string, ..._labels: string[]) => 'Open jsm CHG-7',
      ),
    };
    const act = actions();
    const page = { kind: 'openRecord', record: 'jsm CHG-7', url: 'https://jsm/CHG-7' } as const;
    const answer = await notice(
      { window: shown } as never,
      act,
      'info',
      'awaits approval',
      [{ kind: 'openRecord', record: 'snow CHG-1', url: 'https://snow/CHG-1' }, page],
      ['Show Output'],
    );
    expect(shown.showInformationMessage).toHaveBeenCalledWith(
      'awaits approval',
      'Open snow CHG-1',
      'Open jsm CHG-7',
      'Show Output',
    );
    expect(answer).toBe('Open jsm CHG-7');
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

  function presenter(shown: ReturnType<typeof window>, noticed: () => Noticed | undefined) {
    const validate = vi.fn(async () => {});
    const made = offeringPresenter({
      api: { window: shown } as never,
      actions: actions(),
      confirm: vi.fn(),
      validate,
      sources: { folders: () => [repo as never] },
      report: vi.fn(),
    })(noticed);
    return { made, validate };
  }

  test("offers, after the failure's ways out, the package actions that answer it, and runs the one chosen", async () => {
    const failure: CommandFailure = {
      reason: 'no_team',
      message: 'No team is selected',
      url: 'https://portal/teams/new',
    };
    const shown = window('Answer');
    const run = vi.fn(async () => {});
    const answers = vi.fn(() => [{ label: 'Answer', run }]);
    const { made } = presenter(shown, () => ({ ctx: { stack: STACK }, answers }));

    made.notify('error', 'No team is selected', failure);
    await settled();
    expect(answers).toHaveBeenCalledWith(failure);
    expect(shown.showErrorMessage).toHaveBeenCalledWith(
      'No team is selected',
      'Select Team',
      'Open Portal',
      'Answer',
    );
    expect(run).toHaveBeenCalledOnce();
  });

  test('a failure of a run whose RunCtx names a root offers Validate on that root, which the one chosen validates', async () => {
    const shown = window('Validate');
    const { made, validate } = presenter(shown, () => ({
      ctx: { root: '/work/repo/infra/prod', stack: STACK },
      answers: () => [],
    }));

    made.notify('error', 'no certification', CERTIFICATION);
    await settled();
    expect(shown.showErrorMessage).toHaveBeenCalledWith('no certification', 'Validate');
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
    expect(shown.showErrorMessage).toHaveBeenCalledWith('no certification');
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
