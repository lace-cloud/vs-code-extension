// What the Stacks tree draws, as pure functions of the CLI's documents and
// of naming a root: the state a view that names no root shows and the state
// a list of stacks leaves the view in, each row's label, icon and actions,
// an apply's outcome as a notice with what it offers, and a preview as a
// document.
import type {
  CommandFailure,
  JsonOf,
  RunOutcome,
  RunSlot,
  StackRef,
} from '@lace-cloud/canvas/engine';
import { type ByReason, byReason } from '../engine/command-outcome';
import type { Found } from '../roots/authoring-roots';
import { type Offer, offersFor } from '../vscode/offers';

export type Stack = JsonOf<'stack list'>['items'][number];
export type Run = JsonOf<'run list'>['items'][number];

// The view's state; each but `stacks` is a welcome, with the one action
// that gets past it where there is one.
export type StacksState =
  | 'noFolder'
  | 'noModule'
  | 'severalModules'
  | 'signedOut'
  | 'noOrganization'
  | 'noTeam'
  | 'teamlessOrganization'
  | 'noStack'
  | 'failed'
  | 'stacks';

// The state a refused `stack list` leaves the view in, by the failure's
// reason. A `noTeam` is `teamlessOrganization` when the organization has no
// team to select; that takes a `team list` to tell.
const REFUSALS: ByReason<StacksState> = {
  unauthenticated: 'signedOut',
  no_organization: 'noOrganization',
  no_team: 'noTeam',
};

export function refusedState(failure: CommandFailure | undefined): StacksState {
  return (failure && byReason(REFUSALS, failure.reason)) ?? 'failed';
}

type Rootless = Exclude<Found, { kind: 'root' }>;

// The state of a view that names no root, by the reason finding one gave.
const ROOTLESS: Readonly<Record<Rootless['kind'], StacksState>> = {
  noFolder: 'noFolder',
  noModule: 'noModule',
  several: 'severalModules',
};

export function rootlessState(found: Rootless): StacksState {
  return ROOTLESS[found.kind];
}

export const stackRef = (stack: Stack): StackRef => ({ id: stack.id, slug: stack.slug });

export type RowLook = {
  label: string;
  description: string;
  tooltip: string;
  icon: string;
  contextValue: string;
};

// A stack row: its name and slug, whether its badges are on the canvas, its
// last drift scan, and an apply of it under way.
export function stackLook(stack: Stack, picked: boolean, run: RunSlot): RowLook {
  const applying =
    run !== null && run.outcome.kind === 'running' ? run.phases.at(-1)?.name : undefined;
  const drift =
    stack.lastDriftStatus === null
      ? []
      : [
          `drift ${stack.lastDriftStatus.toLowerCase()}${stack.lastDriftCount > 0 ? ` (${stack.lastDriftCount})` : ''}`,
        ];
  const description = [
    stack.slug,
    ...(picked ? ['on the canvas'] : []),
    ...drift,
    ...(applying === undefined ? [] : [`applying: ${applying}`]),
  ].join(' · ');
  return {
    label: stack.name,
    description,
    tooltip: [
      `Stack: ${stack.name} (${stack.slug})`,
      `Source: ${stack.source ? `${stack.source.repoUrl}${stack.source.path ? ` ${stack.source.path}` : ''}` : 'none'}`,
      `Last applied: ${stack.lastApply?.completedAt ?? 'never'}`,
      `Last drift scan: ${stack.lastDriftScanAt ?? 'never'}`,
    ].join('\n'),
    icon: applying !== undefined ? 'sync~spin' : picked ? 'layers-active' : 'layers',
    contextValue: 'laceStack',
  };
}

const STATUS_ICONS: Readonly<Record<string, string>> = {
  plan_succeeded: 'check',
  plan_failed: 'error',
  policy_eval: 'sync~spin',
  policy_blocked: 'error',
  auto_apply: 'sync~spin',
  awaiting_approval: 'question',
  approved: 'check',
  applying: 'sync~spin',
  apply_succeeded: 'pass-filled',
  apply_failed: 'error',
  cancelled: 'circle-slash',
  rejected: 'error',
};

// A run row: kind and id, status and plan counts. Its actions follow its
// `contextValue`, a list of tokens: `ended` once its document says when it
// completed (`completedAt`, set when a run of any kind reaches its end),
// else `running`; `portal` when the CLI gave it its page.
export function runLook(run: Run): RowLook {
  const count = (n: number | null) => n ?? 0;
  return {
    label: `${run.kind} · ${run.id.slice(0, 12)}`,
    description: `${run.status} · +${count(run.planResourceAdd)} ~${count(run.planResourceChange)} -${count(run.planResourceDestroy)}`,
    tooltip: [
      `Run: ${run.id}`,
      `Kind: ${run.kind}`,
      `Status: ${run.status}`,
      `Started: ${run.startedAt ?? 'not yet'}`,
      ...(run.completedAt ? [`Completed: ${run.completedAt}`] : []),
      ...(run.errorMessage ? [`Error: ${run.errorMessage}`] : []),
    ].join('\n'),
    icon: STATUS_ICONS[run.status] ?? 'circle-outline',
    contextValue: [
      'laceRun',
      run.completedAt === null ? 'running' : 'ended',
      ...(run.url === undefined ? [] : ['portal']),
    ].join(' '),
  };
}

export type Notice = {
  level: 'info' | 'warn' | 'error';
  text: string;
  offers: readonly Offer[];
};

type ChangeRequest = Extract<RunOutcome, { kind: 'awaiting-approval' }>['changeRequest'];
type ChangeRequirement = ChangeRequest['requirements'][number];
type ChangeRecord = ChangeRequest['records'][number];

// Who decides a requirement: Lace, or the change-management system whose
// record settles it, named by that record once its system has opened it.
function deciderSaid(requirement: ChangeRequirement, records: readonly ChangeRecord[]): string {
  if (requirement.decidedBy === 'lace') return 'decided in Lace';
  const record = records.find(({ id }) => id === requirement.recordId);
  if (record === undefined) return 'decided in its change-management system';
  if (record.externalRef === null) return `decided in ${record.kind} (record not opened yet)`;
  return `decided in ${record.kind} ${record.externalRef}`;
}

// What the system decided on a record Lace has read: its decision, that it
// awaits one, or that the system ended the record with none.
function decisionSaid(record: ChangeRecord): string {
  if (record.decision !== null) return `${record.decision} in ${record.kind}`;
  return record.state === 'open' ? 'awaiting its decision' : 'ended with no decision';
}

// What a record says and offers, read once from its shape. A record its
// system has not opened yet has only its system's kind; an opened one has
// its reference, and once Lace has read them, the record's state, the
// system's decision on it and its page, which it offers.
function recordSaid(record: ChangeRecord): { line: string; offers: Offer[] } {
  if (record.externalRef === null) return { line: `${record.kind}: not opened yet`, offers: [] };
  const name = `${record.kind} ${record.externalRef}`;
  const read =
    record.state === null
      ? `${name}: not read yet`
      : `${name}: ${record.state}, ${decisionSaid(record)}`;
  if (record.externalUrl === null) return { line: read, offers: [] };
  return {
    line: `${read}, ${record.externalUrl}`,
    offers: [{ kind: 'openRecord', record: name, url: record.externalUrl }],
  };
}

// What an apply held for approval says, from the change request its gate
// event carries: the change request it waits on and its state, each
// requirement with its state and its decider, and each record a
// change-management system keeps of it, with its state, the system's
// decision and its page. It offers the held Run's page in the portal, where
// a requirement is decided, when the CLI named it, and the page of each
// record that has one.
function awaitingNotice(
  slug: string,
  { id, state, requirements, records }: ChangeRequest,
  runUrl: string | null,
): Notice {
  const said = records.map(recordSaid);
  const runPage: Offer[] = runUrl === null ? [] : [{ kind: 'openPortal', url: runUrl }];
  return {
    level: 'info',
    text: [
      `The change to ${slug} awaits approval: change request ${id}, ${state}.`,
      ...requirements.map(
        (requirement) =>
          `Requirement ${requirement.id}: ${requirement.state}, ${deciderSaid(requirement, records)}.`,
      ),
      ...said.map(({ line }) => `Record ${line}.`),
    ].join(' '),
    offers: [...runPage, ...said.flatMap(({ offers }) => offers)],
  };
}

// What an apply that settled says, and what it offers: the ways out a
// failure's reason names, and the records of a change request it waits on.
export function outcomeNotice(
  slug: string,
  outcome: Exclude<RunOutcome, { kind: 'running' }>,
): Notice {
  switch (outcome.kind) {
    case 'succeeded':
      return { level: 'info', text: `Applied ${slug}.`, offers: [] };
    case 'awaiting-approval':
      return awaitingNotice(slug, outcome.changeRequest, outcome.runUrl);
    case 'blocked':
      return { level: 'warn', text: outcome.message.trim(), offers: offersFor(outcome.failure) };
    case 'failed':
      return { level: 'error', text: outcome.message.trim(), offers: offersFor(outcome.failure) };
    case 'cancelled':
      return { level: 'info', text: `Cancelled the apply of ${slug}.`, offers: [] };
    case 'detached':
      return outcome.submitted
        ? {
            level: 'warn',
            text: `Stopped following the apply of ${slug}; the run goes on.`,
            offers: [],
          }
        : {
            level: 'warn',
            text: `The apply of ${slug} stopped before it was sent; nothing ran.`,
            offers: [],
          };
  }
}

type Preview = JsonOf<'stack preview'>;
type PreviewPolicy = NonNullable<Preview['policy']>;
type PreviewBinding = PreviewPolicy['bindings'][number];
type PreviewEntry = Preview['advisories']['queue']['entries'][number];

// What a policy answers that reads what only a run carries.
const DECIDED_AT_APPLY = 'decided_at_apply';

// The decisions a policy answers that read as words rather than as a
// resolution kind.
const DECISION_WORDS: Readonly<Record<string, string>> = {
  [DECIDED_AT_APPLY]: 'decided at apply',
  abstain: 'no opinion',
};

// One policy's own answer: its decision, that an observing policy's block
// never blocks the Run, and the reason it gives.
function bindingAnswer(binding: PreviewBinding): string {
  const reason = binding.reason.trim();
  const observed =
    binding.mode === 'observing' && binding.decision === 'policy_blocked'
      ? ' (observing: an observing policy never blocks the Run)'
      : '';
  return `${DECISION_WORDS[binding.decision] ?? binding.decision}${observed}${reason === '' ? '' : ` — ${reason}`}`;
}

// The Run-level verdict: decided at apply with why and the policy that
// decides it, else the mode and the rules that fired in which policy, or
// that none did, and a block's reason.
function verdictText(policy: PreviewPolicy): string {
  const reason = policy.reason.trim();
  if (policy.mode === DECIDED_AT_APPLY)
    return `${DECISION_WORDS[DECIDED_AT_APPLY]} — ${reason} (policy ${policy.policyId})`;
  const fired =
    policy.rulesFired.length === 0
      ? 'no rule fired'
      : `rule(s) ${policy.rulesFired.join(', ')} fired${policy.policyId === '' ? '' : ` (policy ${policy.policyId})`}`;
  const blocked = policy.mode === 'policy_blocked' && reason !== '' ? `: ${reason}` : '';
  return `${policy.mode} — ${fired}${blocked}`;
}

// A preview's policy verdict as `lace stack preview` prints it: the
// Run-level verdict, then, when several policies answer, one line per
// policy with its own answer.
function policyText(policy: PreviewPolicy): string {
  return [
    `Policy: ${verdictText(policy)}`,
    ...(policy.bindings.length > 1
      ? policy.bindings.map(
          (binding) =>
            `  ${binding.policyId}  ${binding.name} (${binding.handler}, ${binding.mode}): ${bindingAnswer(binding)}`,
        )
      : []),
  ].join('\n');
}

// One subject of the preview's Advisories: its leading Advisory's Agent,
// confidence and summary (the subject itself when the Advisory offers no
// summary), then whether the Agents disagree or how many agree.
function entryText(entry: PreviewEntry): string {
  const primary =
    entry.kind === 'disagreement' ? entry.lanes[0].advisories[0] : entry.advisories[0];
  const output = primary.outputJson;
  const offered =
    typeof output === 'object' && output !== null && 'summary' in output ? output.summary : null;
  const summary =
    typeof offered === 'string' && offered !== ''
      ? offered
      : `${entry.subject.riskCategory} on ${entry.subject.resourceUri}`;
  const line = `${primary.emittedByDisplayName} (${Math.round(primary.confidenceScore * 100)}%): ${summary}`;
  if (entry.kind === 'disagreement')
    return `${line} — Agents disagree on ${entry.subject.riskCategory}`;
  return entry.agentCount > 1 ? `${line} — ${entry.agentCount} Agents agree` : line;
}

// What the preview shows of the Agents bound at Preview: one line per
// subject of its queue and how many are under the Preview's floor, or that
// it shows none, then how many bound Agents have not answered. A preview
// no Agent is bound at says so.
function advisoriesText({ queue, pending, bound }: Preview['advisories']): string {
  if (bound === 0) return 'Advisories: no Agent is installed and bound at Preview';
  const listed =
    queue.entries.length > 0
      ? [
          'Advisories:',
          ...queue.entries.map((entry) => `  ${entryText(entry)}`),
          ...(queue.belowFloor > 0 ? [`  ${queue.belowFloor} more under the Preview floor`] : []),
        ]
      : [
          `Advisories: none${queue.belowFloor > 0 ? ` (${queue.belowFloor} under the Preview floor)` : ''}`,
        ];
  return [
    ...listed,
    ...(pending > 0 ? [`  ${pending} bound Agent(s) have not answered`] : []),
  ].join('\n');
}

// A preview as a read-only document: the plan as terraform shows it, which
// ends with terraform's own summary of it, the policy verdict and the
// Advisories.
export function previewText(preview: Preview): string {
  const { policy } = preview;
  return [
    `Preview of ${preview.stack.slug} (tree ${preview.treeHash})`,
    '',
    preview.plan.human,
    '',
    policy === null ? 'Policy: none applies' : policyText(policy),
    '',
    advisoriesText(preview.advisories),
    '',
  ].join('\n');
}
