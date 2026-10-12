import { type CommandFailure, type LaceReason, parseBound } from '@lace-cloud/canvas/engine';
import { describe, expect, test } from 'vitest';
import { outcomeNotice, previewText, refusedState } from '../stack-rows';

// A preview whose policy verdict gives `reason`.
const preview = (
  reason: string,
  more: { rulesFired?: string[]; approvalMode?: string | null } = {},
) =>
  parseBound('stack preview', {
    stack: { id: 'stk_1', slug: 'prod' },
    treeHash: 'h1',
    plan: {
      summary: { resourceAdd: 1, resourceChange: 0, resourceDestroy: 0 },
      human: '+ aws_s3_bucket.b',
    },
    policy: {
      mode: 'require_approval',
      policyId: 'pol_1',
      ruleId: 'rule_1',
      rulesFired: [],
      reason,
      approvalMode: null,
      isAuthoringTimePreview: false,
      ...more,
    },
  });

// The policy line of a preview's document.
const policyLine = (text: string): string | undefined =>
  text.split('\n').find((line) => line.startsWith('Policy:'));

describe("a preview's policy verdict", () => {
  test('names its mode, policy and rule, then the reason it gives', () => {
    expect(policyLine(previewText(preview('a change to prod needs approval')))).toBe(
      'Policy: require_approval (pol_1, rule rule_1): a change to prod needs approval',
    );
  });

  test('with no reason ends at its rule, with no dangling colon', () => {
    expect(policyLine(previewText(preview('')))).toBe(
      'Policy: require_approval (pol_1, rule rule_1)',
    );
    expect(policyLine(previewText(preview('  ')))).toBe(
      'Policy: require_approval (pol_1, rule rule_1)',
    );
  });

  test('is followed by the rules fired and the approval it asks for', () => {
    const text = previewText(preview('', { rulesFired: ['r1', 'r2'], approvalMode: 'any_one' }));
    expect(
      text.endsWith(
        'Policy: require_approval (pol_1, rule rule_1)\nRules fired: r1, r2\nApproval: any_one\n',
      ),
    ).toBe(true);
  });
});

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
