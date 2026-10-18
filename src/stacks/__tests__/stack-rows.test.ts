import { type CommandFailure, type LaceReason, parseBound } from '@lace-cloud/canvas/engine';
import { describe, expect, test } from 'vitest';
import { outcomeNotice, previewText, refusedState, rootlessState, runLook } from '../stack-rows';
import { run } from './stack-fixtures';

type Binding = {
  policyId: string;
  name: string;
  handler: string;
  mode: string;
  decision: string;
  reason: string;
};

// The Advisories of a preview: none, from one bound Agent that answered.
const NO_ADVISORIES = {
  queue: { manifestation: 'preview', floor: 0.5, entries: [] as object[], belowFloor: 0 },
  truncated: false,
  pending: 0,
  bound: 1,
};

// The plan of a preview as terraform shows it, which ends with terraform's
// own summary of it.
const HUMAN = [
  'Terraform will perform the following actions:',
  '',
  '  # aws_s3_bucket.b will be created',
  '  + resource "aws_s3_bucket" "b" {',
  '      + bucket = "b"',
  '    }',
  '',
  'Plan: 1 to add, 0 to change, 0 to destroy.',
].join('\n');

// A preview whose policy verdict gives `reason`.
const preview = (
  reason: string,
  more: {
    mode?: string;
    policyId?: string;
    ruleId?: string;
    rulesFired?: string[];
    approvalMode?: string | null;
    bindings?: Binding[];
  } = {},
  advisories: object = NO_ADVISORIES,
) =>
  parseBound('stack preview', {
    stack: { id: 'stk_1', slug: 'prod' },
    treeHash: 'h1',
    plan: {
      summary: { resourceAdd: 1, resourceChange: 0, resourceDestroy: 0 },
      human: HUMAN,
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
      bindings: (more.bindings ?? []).map((binding) => ({
        ...binding,
        rulesFired: [],
        approvalMode: null,
      })),
    },
    advisories,
  });

// The policy line of a preview's document.
const policyLine = (text: string): string | undefined =>
  text.split('\n').find((line) => line.startsWith('Policy:'));

// The lines of a preview's document from its first line starting with
// `heading` to the blank line that ends that part.
const part = (text: string, heading: string): string[] => {
  const lines = text.split('\n');
  const from = lines.findIndex((line) => line.startsWith(heading));
  const to = lines.indexOf('', from);
  return lines.slice(from, to);
};

describe("a preview's document", () => {
  test("holds the plan as terraform shows it, whose summary is the document's one Plan line, then the verdict", () => {
    const text = previewText(preview(''));
    const lines = text.split('\n');
    expect(lines.filter((line) => line.startsWith('Plan:'))).toEqual([
      'Plan: 1 to add, 0 to change, 0 to destroy.',
    ]);
    expect(lines.slice(0, 11)).toEqual(['Preview of prod (tree h1)', '', ...HUMAN.split('\n'), '']);
    expect(policyLine(text)).toBe('Policy: require_approval — rule rule_1 decided (policy pol_1)');
  });
});

// The verdict states the policy result's mode, the rule that decided it,
// the conditions that fired, the deciding policy, and a block's reason or
// why it is decided at apply, then, when several policies answer, one
// answer per policy.
describe("a preview's policy verdict", () => {
  test('names its mode, the rule that decided it and the deciding policy', () => {
    expect(policyLine(previewText(preview('')))).toBe(
      'Policy: require_approval — rule rule_1 decided (policy pol_1)',
    );
  });

  test('names the conditions that fired beside the rule that decided', () => {
    expect(policyLine(previewText(preview('', { rulesFired: ['r1', 'r2'] })))).toBe(
      'Policy: require_approval — rule rule_1 decided, conditions r1, r2 fired (policy pol_1)',
    );
    expect(policyLine(previewText(preview('', { rulesFired: ['r1'], policyId: '' })))).toBe(
      'Policy: require_approval — rule rule_1 decided, condition r1 fired',
    );
  });

  test('says when no rule decided, and the conditions that fired when some did', () => {
    expect(policyLine(previewText(preview('', { ruleId: '' })))).toBe(
      'Policy: require_approval — no rule decided (policy pol_1)',
    );
    expect(policyLine(previewText(preview('', { ruleId: '', rulesFired: ['r1'] })))).toBe(
      'Policy: require_approval — condition r1 fired (policy pol_1)',
    );
  });

  test('gives the reason of a block, with no dangling colon when it gives none', () => {
    const blocked = (reason: string) =>
      policyLine(
        previewText(preview(reason, { mode: 'policy_blocked', rulesFired: ['block-adds'] })),
      );
    const decided =
      'Policy: policy_blocked — rule rule_1 decided, condition block-adds fired (policy pol_1)';
    expect(blocked('Freeze: adds are blocked')).toBe(`${decided}: Freeze: adds are blocked`);
    expect(blocked('')).toBe(decided);
    expect(blocked('  ')).toBe(decided);
  });

  test('gives no reason for an answer that is not a block', () => {
    expect(policyLine(previewText(preview('a change to prod needs approval')))).toBe(
      'Policy: require_approval — rule rule_1 decided (policy pol_1)',
    );
  });

  test('decided at apply, says why and names the policy that decides it', () => {
    expect(
      policyLine(
        previewText(
          preview('it reads the stack’s drift when the run reaches the gate', {
            mode: 'decided_at_apply',
          }),
        ),
      ),
    ).toBe(
      'Policy: decided at apply — it reads the stack’s drift when the run reaches the gate (policy pol_1)',
    );
  });

  test('is one line, whatever conditions fired and whatever approval it asks for', () => {
    const text = previewText(preview('', { rulesFired: ['r1', 'r2'], approvalMode: 'any_one' }));
    expect(part(text, 'Policy:')).toEqual([
      'Policy: require_approval — rule rule_1 decided, conditions r1, r2 fired (policy pol_1)',
    ]);
  });

  test('when several policies answer, is followed by one line per policy with its own answer', () => {
    const text = previewText(
      preview('', {
        bindings: [
          {
            policyId: 'pol_1',
            name: 'prod-gate',
            handler: 'opa',
            mode: 'gating',
            decision: 'require_approval',
            reason: 'a change to prod needs approval',
          },
          {
            policyId: 'pol_2',
            name: 'cost',
            handler: 'builtin',
            mode: 'observing',
            decision: 'policy_blocked',
            reason: 'over budget',
          },
          {
            policyId: 'pol_3',
            name: 'tags',
            handler: 'builtin',
            mode: 'gating',
            decision: 'abstain',
            reason: '',
          },
          {
            policyId: 'pol_4',
            name: 'actor',
            handler: 'external',
            mode: 'gating',
            decision: 'decided_at_apply',
            reason: 'reads the submitting actor',
          },
        ],
      }),
    );
    expect(part(text, 'Policy:')).toEqual([
      'Policy: require_approval — rule rule_1 decided (policy pol_1)',
      '  pol_1  prod-gate (opa, gating): require_approval — a change to prod needs approval',
      '  pol_2  cost (builtin, observing): policy_blocked (observing: an observing policy never blocks the Run) — over budget',
      '  pol_3  tags (builtin, gating): no opinion',
      '  pol_4  actor (external, gating): decided at apply — reads the submitting actor',
    ]);
  });

  test('when one policy answers, the verdict is its answer and it is not listed again', () => {
    const text = previewText(
      preview('', {
        bindings: [
          {
            policyId: 'pol_1',
            name: 'prod-gate',
            handler: 'opa',
            mode: 'gating',
            decision: 'require_approval',
            reason: '',
          },
        ],
      }),
    );
    expect(part(text, 'Policy:')).toEqual([
      'Policy: require_approval — rule rule_1 decided (policy pol_1)',
    ]);
  });
});

// An Advisory of `agent` at `confidence` whose output is `output`.
const advisory = (agent: string, confidence: number, output: unknown = {}) => ({
  id: `adv_${agent}`,
  manifestation: 'preview',
  emittedByInstallId: `inst_${agent}`,
  emittedByDisplayName: agent,
  confidenceScore: confidence,
  producedAt: '2026-10-13T00:00:00Z',
  outputJson: output,
});

const SUBJECT = {
  resourceUri: 'aws_s3_bucket.b',
  riskCategory: 'public_access',
  remediationKind: 'block_public_access',
};

// The Advisories part of the document of a preview whose Advisories are
// `advisories`.
const advisoriesOf = (advisories: object): string[] =>
  part(previewText(preview('', {}, advisories)), 'Advisories:');

describe("a preview's Advisories", () => {
  test('of a stack no Agent is bound at Preview on say so', () => {
    expect(advisoriesOf({ ...NO_ADVISORIES, bound: 0 })).toEqual([
      'Advisories: no Agent is installed and bound at Preview',
    ]);
  });

  test('that list none say so, with how many are under the Preview floor', () => {
    expect(advisoriesOf(NO_ADVISORIES)).toEqual(['Advisories: none']);
    expect(
      advisoriesOf({ ...NO_ADVISORIES, queue: { ...NO_ADVISORIES.queue, belowFloor: 2 } }),
    ).toEqual(['Advisories: none (2 under the Preview floor)']);
  });

  test("list one line per subject: the leading Advisory's Agent, confidence and summary, then whether Agents agree or disagree", () => {
    const lines = advisoriesOf({
      ...NO_ADVISORIES,
      queue: {
        ...NO_ADVISORIES.queue,
        entries: [
          {
            kind: 'consensus',
            subject: { ...SUBJECT, remediationFingerprint: 'f1' },
            advisories: [
              advisory('Guard', 0.92, { summary: 'The bucket is public' }),
              advisory('Sentry', 0.8),
            ],
            agentCount: 2,
          },
          {
            kind: 'consensus',
            subject: { ...SUBJECT, remediationFingerprint: 'f2' },
            advisories: [advisory('Guard', 0.6, { summary: 7 })],
            agentCount: 1,
          },
          {
            kind: 'disagreement',
            subject: SUBJECT,
            lanes: [
              {
                remediationFingerprint: 'f1',
                advisories: [advisory('Guard', 0.75, { summary: 'Block public access' })],
              },
              { remediationFingerprint: 'f3', advisories: [advisory('Sentry', 0.7)] },
            ],
          },
        ],
        belowFloor: 1,
      },
      pending: 2,
    });
    expect(lines).toEqual([
      'Advisories:',
      '  Guard (92%): The bucket is public — 2 Agents agree',
      '  Guard (60%): public_access on aws_s3_bucket.b',
      '  Guard (75%): Block public access — Agents disagree on public_access',
      '  1 more under the Preview floor',
      '  2 bound Agent(s) have not answered',
    ]);
  });

  test('end the document, after the policy verdict', () => {
    expect(previewText(preview('')).endsWith('\n\nAdvisories: none\n')).toBe(true);
  });
});

describe("a run row's actions", () => {
  const COMPLETED = '2026-09-01T01:00:00Z';
  const PAGE = 'https://portal/o/t/stacks/stk_1/runs/run_1';
  const contextOf = (...made: Parameters<typeof run>) => runLook(run(...made)).contextValue;

  test('a run whose document says when it completed has ended, whatever its status', () => {
    expect(contextOf('run_1', 'apply_succeeded', { completedAt: COMPLETED })).toBe('laceRun ended');
    expect(contextOf('run_2', 'plan_succeeded', { completedAt: COMPLETED })).toBe('laceRun ended');
    expect(contextOf('run_3', 'cancelled', { completedAt: COMPLETED })).toBe('laceRun ended');
  });

  test('a run whose document says no completion is running, whatever its status', () => {
    expect(contextOf('run_1', 'applying')).toBe('laceRun running');
    expect(contextOf('run_2', 'awaiting_approval')).toBe('laceRun running');
    expect(contextOf('run_3', 'plan_succeeded')).toBe('laceRun running');
  });

  test('a run with a page offers it, ended or running', () => {
    expect(contextOf('run_1', 'applying', { url: PAGE })).toBe('laceRun running portal');
    expect(contextOf('run_2', 'apply_failed', { completedAt: COMPLETED, url: PAGE })).toBe(
      'laceRun ended portal',
    );
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

describe('the state of a view that names no root', () => {
  test('is named by the reason finding one gave', () => {
    expect(rootlessState({ kind: 'noFolder' })).toBe('noFolder');
    expect(rootlessState({ kind: 'noModule' })).toBe('noModule');
    expect(rootlessState({ kind: 'several', roots: [] })).toBe('severalModules');
  });
});

describe('what a settled apply says', () => {
  test('each outcome has its notice; a failure offers the ways out its reason names', () => {
    const failure: CommandFailure = { reason: 'stale_certification', message: 'stale' };
    expect(outcomeNotice('prod', { outcome: { kind: 'succeeded' }, run: null })).toEqual({
      level: 'info',
      text: 'Applied prod.',
      offers: [],
    });
    expect(
      outcomeNotice('prod', {
        outcome: { kind: 'blocked', message: 'Error: stale\n', failure },
        run: null,
      }),
    ).toEqual({
      level: 'warn',
      text: 'Error: stale',
      offers: [{ kind: 'validate' }],
    });
    expect(
      outcomeNotice('prod', { outcome: { kind: 'failed', message: 'Error: boom' }, run: null }),
    ).toEqual({
      level: 'error',
      text: 'Error: boom',
      offers: [],
    });
    expect(outcomeNotice('prod', { outcome: { kind: 'cancelled' }, run: null }).text).toBe(
      'Cancelled the apply of prod.',
    );
    expect(
      outcomeNotice('prod', { outcome: { kind: 'detached', submitted: true }, run: null }).text,
    ).toBe('Stopped following the apply of prod; the run goes on.');
    expect(
      outcomeNotice('prod', { outcome: { kind: 'detached', submitted: false }, run: null }).text,
    ).toBe('The apply of prod stopped before it was sent; nothing ran.');
  });
});

describe('what an apply held for approval says', () => {
  type Requirement = {
    id: string;
    state: string;
    decidedBy: 'lace' | 'ecm';
    recordId: string | null;
  };
  type Record = {
    id: string;
    externalSystemId: string;
    kind: string;
    externalRef: string | null;
    externalUrl: string | null;
    state: string | null;
    decision: 'approved' | 'rejected' | null;
  };
  const awaiting = (requirements: Requirement[], records: Record[], url?: string) =>
    outcomeNotice('prod', {
      outcome: {
        kind: 'awaiting-approval',
        changeRequest: { id: 'chg_1', state: 'submitted', requirements, records },
      },
      run: url === undefined ? null : run('run_1', 'awaiting_approval', { url }),
    });
  const jsm = (fields: Partial<Record>): Record => ({
    id: 'crec_jsm',
    externalSystemId: 'esys_jsm',
    kind: 'jsm',
    externalRef: 'CHG-42',
    externalUrl: 'https://acme.atlassian.net/browse/CHG-42',
    state: 'open',
    decision: null,
    ...fields,
  });
  const byJsm: Requirement = {
    id: 'creq_jsm',
    state: 'pending',
    decidedBy: 'ecm',
    recordId: 'crec_jsm',
  };

  test('a change request Lace alone decides names its requirement, and offers nothing to open', () => {
    expect(
      awaiting([{ id: 'creq_policy', state: 'pending', decidedBy: 'lace', recordId: null }], []),
    ).toEqual({
      level: 'info',
      text: 'The change to prod awaits approval: change request chg_1, submitted. Requirement creq_policy: pending, decided in Lace.',
      offers: [],
    });
  });

  test('a requirement a change-management system decides names the record that settles it, the record its state, the system’s decision and its page, and offers the page', () => {
    expect(
      awaiting(
        [{ id: 'creq_policy', state: 'approved', decidedBy: 'lace', recordId: null }, byJsm],
        [jsm({})],
      ),
    ).toEqual({
      level: 'info',
      text: 'The change to prod awaits approval: change request chg_1, submitted. Requirement creq_policy: approved, decided in Lace. Requirement creq_jsm: pending, decided in jsm CHG-42. Record jsm CHG-42: open, awaiting its decision, https://acme.atlassian.net/browse/CHG-42.',
      offers: [
        {
          kind: 'openRecord',
          record: 'jsm CHG-42',
          url: 'https://acme.atlassian.net/browse/CHG-42',
        },
      ],
    });
  });

  test('the held Run’s page, where its requirements are decided, is offered first once the CLI names it', () => {
    const runPage = 'https://lace.cloud/acme/platform/stacks/stk_1/runs/run_9';
    expect(awaiting([byJsm], [jsm({})], runPage).offers).toEqual([
      { kind: 'openPortal', url: runPage },
      { kind: 'openRecord', record: 'jsm CHG-42', url: 'https://acme.atlassian.net/browse/CHG-42' },
    ]);
  });

  test('a record says the decision its system took on it', () => {
    expect(awaiting([byJsm], [jsm({ decision: 'approved' })]).text).toContain(
      'Record jsm CHG-42: open, approved in jsm, https://acme.atlassian.net/browse/CHG-42.',
    );
  });

  test('a record its system ended with no decision says so', () => {
    expect(awaiting([byJsm], [jsm({ state: 'cancelled' })]).text).toContain(
      'Record jsm CHG-42: cancelled, ended with no decision, https://acme.atlassian.net/browse/CHG-42.',
    );
  });

  test('a record its system has not opened yet says so, names its system as the decider, and has no page to offer', () => {
    expect(awaiting([byJsm], [jsm({ externalRef: null, externalUrl: null, state: null })])).toEqual(
      {
        level: 'info',
        text: 'The change to prod awaits approval: change request chg_1, submitted. Requirement creq_jsm: pending, decided in jsm (record not opened yet). Record jsm: not opened yet.',
        offers: [],
      },
    );
  });

  test('a requirement whose record the change request does not carry names no system', () => {
    expect(awaiting([{ ...byJsm, recordId: null }], []).text).toContain(
      'Requirement creq_jsm: pending, decided in its change-management system.',
    );
  });

  test('a record opened but not read yet says so', () => {
    expect(awaiting([byJsm], [jsm({ externalUrl: null, state: null })]).text).toContain(
      'Record jsm CHG-42: not read yet.',
    );
  });
});
