import type { CommandFailure, LaceReason } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import { notice, type OfferActions, offersFor } from '../offers';

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
