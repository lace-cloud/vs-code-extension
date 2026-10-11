import type { CommandFailure, LaceReason } from '@lace-cloud/canvas/engine';
import { describe, expect, test } from 'vitest';
import { outcomeNotice, refusedState } from '../stack-rows';

describe('the state a refused list leaves', () => {
  test('is named by the reason', () => {
    const failure = (reason: LaceReason) => ({ reason, message: 'text' });
    expect(refusedState(failure('unauthenticated'))).toBe('signedOut');
    expect(refusedState(failure('no_organization'))).toBe('noOrganization');
    expect(refusedState(failure('no_team'))).toBe('noTeam');
    expect(refusedState(failure('unspecified'))).toBe('failed');
    expect(refusedState(undefined)).toBe('failed');
  });
});

describe('what a settled apply says', () => {
  test('each outcome has its notice; a failure keeps its document', () => {
    const failure: CommandFailure = { reason: 'stale_certification', message: 'stale' };
    expect(outcomeNotice('prod', { kind: 'succeeded' })).toEqual({
      level: 'info',
      text: 'Applied prod.',
    });
    expect(outcomeNotice('prod', { kind: 'awaiting-approval', changeRequestId: 'cr_1' })).toEqual({
      level: 'info',
      text: 'The change to prod awaits approval.',
    });
    expect(outcomeNotice('prod', { kind: 'blocked', message: 'Error: stale\n', failure })).toEqual({
      level: 'warn',
      text: 'Error: stale',
      failure,
    });
    expect(outcomeNotice('prod', { kind: 'failed', message: 'Error: boom' })).toEqual({
      level: 'error',
      text: 'Error: boom',
      failure: undefined,
    });
    expect(outcomeNotice('prod', { kind: 'cancelled' }).text).toBe('Cancelled the apply of prod.');
    expect(outcomeNotice('prod', { kind: 'detached', submitted: true }).text).toBe(
      'Stopped following the apply of prod; the run goes on.',
    );
    expect(outcomeNotice('prod', { kind: 'detached', submitted: false }).text).toBe(
      'The apply of prod stopped before it was sent; nothing ran.',
    );
  });
});
