import {
  type CommandFailure,
  type LaceReason,
  parseBound,
  type RunOutcome,
} from '@lace-cloud/canvas/engine';
import { describe, expect, test } from 'vitest';
import {
  outcomeNotice,
  previewText,
  refusedState,
  rootlessState,
  runLook,
  stackLook,
} from '../stack-rows';
import { run, stack } from './stack-fixtures';

// One Binding's own answer at the gate, and one Binding that decided it.
type Binding = {
  bindingId: string;
  name: string;
  handler: string;
  mode: string;
  decision: string;
  reason: string;
};
type Decider = { bindingId: string; ruleId?: string; rulesFired: string[] };

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

// A preview whose gate resolution gives `reason`: awaiting approval, decided
// by one Binding's rule, unless `more` says otherwise.
const preview = (
  reason: string,
  more: {
    mode?: string;
    decidedBy?: Decider[];
    approvalMode?: string;
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
    resolution: {
      mode: 'awaiting_approval',
      reason,
      decidedBy: [{ bindingId: 'hbnd_prod', ruleId: 'prod-apply', rulesFired: [] }],
      isAuthoringTimePreview: true,
      ...more,
      bindings: (more.bindings ?? []).map((binding) => ({
        ...binding,
        rulesFired: [],
        approvalMode: null,
      })),
    },
    advisories,
  });

// The lines of a preview's document from its first line starting with
// `heading` to the blank line that ends that part.
const part = (text: string, heading: string): string[] => {
  const lines = text.split('\n');
  const from = lines.findIndex((line) => line.startsWith(heading));
  const to = lines.indexOf('', from);
  return lines.slice(from, to);
};

// The gate's part of a preview's document.
const gate = (text: string): string[] => part(text, 'Gate:');

describe("a preview's document", () => {
  test("holds the plan as terraform shows it, whose summary is the document's one Plan line, then the gate's resolution", () => {
    const text = previewText(preview(''));
    const lines = text.split('\n');
    expect(lines.filter((line) => line.startsWith('Plan:'))).toEqual([
      'Plan: 1 to add, 0 to change, 0 to destroy.',
    ]);
    expect(lines.slice(0, 11)).toEqual(['Preview of prod (tree h1)', '', ...HUMAN.split('\n'), '']);
    expect(gate(text)).toEqual([
      'Gate: awaiting_approval',
      '      binding hbnd_prod — rule prod-apply decided',
    ]);
  });
});

// The gate's resolution as `lace stack preview` states it: its mode, the
// reason of a block or of an answer decided at apply, one line per Binding
// that decided it, then, when several Bindings answer, one answer per
// Binding.
describe("a preview's gate resolution", () => {
  test('names each Binding that decided it, with the rule that decided and the conditions that fired', () => {
    const text = previewText(
      preview('', {
        decidedBy: [
          { bindingId: 'hbnd_prod', ruleId: 'prod', rulesFired: ['no-deletes', 'big-change'] },
          { bindingId: 'hbnd_security', rulesFired: ['changes-iam'] },
        ],
      }),
    );
    expect(gate(text)).toEqual([
      'Gate: awaiting_approval',
      '      binding hbnd_prod — rule prod decided, condition(s) no-deletes, big-change fired',
      '      binding hbnd_security — condition(s) changes-iam fired',
    ]);
  });

  test('says when no Binding decided it, and when a Binding decided it by no rule', () => {
    expect(gate(previewText(preview('', { mode: 'auto_apply', decidedBy: [] })))).toEqual([
      'Gate: auto_apply — no binding decided',
    ]);
    expect(
      gate(previewText(preview('', { decidedBy: [{ bindingId: 'hbnd_drift', rulesFired: [] }] }))),
    ).toEqual(['Gate: awaiting_approval', '      binding hbnd_drift — no rule decided']);
  });

  test('gives the reason of a block, with no dangling colon when it gives none', () => {
    const blocked = (reason: string) =>
      gate(
        previewText(
          preview(reason, {
            mode: 'blocked',
            decidedBy: [
              { bindingId: 'hbnd_freeze', ruleId: 'r_freeze', rulesFired: ['block-adds'] },
            ],
          }),
        ),
      )[0];
    expect(blocked('Freeze: adds are blocked')).toBe('Gate: blocked: Freeze: adds are blocked');
    expect(blocked('')).toBe('Gate: blocked');
  });

  test('says why an answer is decided at apply', () => {
    expect(
      gate(
        previewText(
          preview('it reads the stack’s drift when the run reaches the gate', {
            mode: 'decided_at_apply',
          }),
        ),
      )[0],
    ).toBe('Gate: decided_at_apply: it reads the stack’s drift when the run reaches the gate');
  });

  test('gives no reason for an answer that is neither a block nor decided at apply, whatever approval it asks for', () => {
    expect(
      gate(
        previewText(
          preview('a change to prod needs approval', { approvalMode: 'single_approver' }),
        ),
      ),
    ).toEqual(['Gate: awaiting_approval', '      binding hbnd_prod — rule prod-apply decided']);
  });

  test('when several Bindings answer, is followed by one line per Binding with its own answer', () => {
    const text = previewText(
      preview('', {
        bindings: [
          {
            bindingId: 'hbnd_prod',
            name: 'prod-gate',
            handler: 'lace/approval-policy',
            mode: 'gating',
            decision: 'awaiting_approval',
            reason: 'a change to prod needs approval',
          },
          {
            bindingId: 'hbnd_cost',
            name: 'cost',
            handler: 'acme/cost',
            mode: 'observing',
            decision: 'blocked',
            reason: 'over budget',
          },
          {
            bindingId: 'hbnd_tags',
            name: 'tags',
            handler: 'acme/tags',
            mode: 'gating',
            decision: 'abstain',
            reason: '',
          },
          {
            bindingId: 'hbnd_actor',
            name: 'actor',
            handler: 'acme/actor',
            mode: 'gating',
            decision: 'decided_at_apply',
            reason: 'reads the submitting actor',
          },
        ],
      }),
    );
    expect(gate(text)).toEqual([
      'Gate: awaiting_approval',
      '      binding hbnd_prod — rule prod-apply decided',
      '  hbnd_prod  prod-gate (lace/approval-policy, gating): awaiting_approval — a change to prod needs approval',
      '  hbnd_cost  cost (acme/cost, observing): blocked (observing: an observing binding never blocks the Run) — over budget',
      '  hbnd_tags  tags (acme/tags, gating): abstain',
      '  hbnd_actor  actor (acme/actor, gating): decided_at_apply — reads the submitting actor',
    ]);
  });

  test('when one Binding answers, the resolution is its answer and it is not listed again', () => {
    const text = previewText(
      preview('', {
        bindings: [
          {
            bindingId: 'hbnd_prod',
            name: 'prod-gate',
            handler: 'lace/approval-policy',
            mode: 'gating',
            decision: 'awaiting_approval',
            reason: '',
          },
        ],
      }),
    );
    expect(gate(text)).toEqual([
      'Gate: awaiting_approval',
      '      binding hbnd_prod — rule prod-apply decided',
    ]);
  });
});

// An Advisory of `agent` at `confidence` whose output is `output`.
const advisory = (agent: string, confidence: number, output: unknown = {}) => ({
  id: `adv_${agent}`,
  orgId: 'org_test',
  contextRunId: null,
  contextInstallId: null,
  contextStackId: 'stack-a',
  contextTreeHash: 'th1',
  contextIncidentId: null,
  contextFormOpeningId: null,
  consumerActorKind: null,
  consumerActorId: null,
  actedOn: null,
  actedAt: null,
  actedBy: null,
  feedbackThumbs: null,
  feedbackText: null,
  emitterKind: 'external',
  emitterHeededRate: 1,
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

  test("end the document, after the gate's resolution", () => {
    expect(previewText(preview('')).endsWith('\n\nAdvisories: none\n')).toBe(true);
  });
});

describe("a stack row's look", () => {
  const named = { ...stack('stk_1', 'prod'), name: 'prod' };
  const drifted = { ...named, lastDriftStatus: 'DRIFTED', lastDriftCount: 1 };

  test('names the slug beside a name that differs from it', () => {
    const look = stackLook(stack('stk_1', 'prod'), true, null);
    expect(look.label).toBe('Prod');
    expect(look.description).toBe('prod · picked for this module');
    expect(look.tooltip.split('\n')[0]).toBe('Stack: Prod (prod)');
  });

  test('names a name that is its slug once, in the row and in its tooltip', () => {
    expect(stackLook(named, false, null).description).toBe('');
    expect(stackLook(named, true, null).description).toBe('picked for this module');
    expect(stackLook(drifted, true, null).description).toBe(
      'picked for this module · drift drifted (1)',
    );
    expect(stackLook(named, false, null).tooltip.split('\n')[0]).toBe('Stack: prod');
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
  test('each outcome has its notice; a failure offers the ways out its reason names, beside the failure the package answers', () => {
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
      failure,
    });
    expect(
      outcomeNotice('prod', { outcome: { kind: 'failed', message: 'Error: boom' }, run: null }),
    ).toEqual({
      level: 'error',
      text: 'Error: boom',
      offers: [],
    });
    expect(outcomeNotice('prod', { outcome: { kind: 'cancelled' }, run: null })).toEqual({
      level: 'info',
      text: 'Cancelled the apply of prod.',
      offers: [],
    });
    expect(
      outcomeNotice('prod', { outcome: { kind: 'detached', submitted: true }, run: null }).text,
    ).toBe('Stopped following the apply of prod; the run goes on.');
    expect(
      outcomeNotice('prod', { outcome: { kind: 'detached', submitted: false }, run: null }).text,
    ).toBe('The apply of prod stopped before it was sent; nothing ran.');
  });
});

describe('what an apply held for approval says', () => {
  type ChangeRequest = Extract<RunOutcome, { kind: 'awaiting-approval' }>['changeRequest'];
  type Requirement = ChangeRequest['requirements'][number];
  type Record = ChangeRequest['records'][number];
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
    changeManagementSystemId: 'cms_jsm',
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
