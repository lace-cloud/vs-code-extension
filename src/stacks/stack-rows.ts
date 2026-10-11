// What the Stacks tree draws, as pure functions of the CLI's documents: the
// state a list of stacks leaves the view in, each row's label, icon and
// actions, an apply's outcome as a notice, and a preview as a document.
import type {
  CommandFailure,
  JsonOf,
  RunOutcome,
  RunSlot,
  StackRef,
} from '@lace-cloud/canvas/engine';
import { type ByReason, byReason } from '../engine/command-outcome';

export type Stack = JsonOf<'stack list'>['items'][number];
export type Run = JsonOf<'run list'>['items'][number];

// The view's state; each but `stacks` is a welcome with its one action.
export type StacksState =
  | 'noRoot'
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

// A run row: kind and id, status and plan counts. It opens in the portal
// when the CLI gave it its page.
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
    contextValue: run.url === undefined ? 'laceRun' : 'laceRun portal',
  };
}

export type Notice = {
  level: 'info' | 'warn' | 'error';
  text: string;
  failure?: CommandFailure;
};

// What an apply that settled says.
export function outcomeNotice(
  slug: string,
  outcome: Exclude<RunOutcome, { kind: 'running' }>,
): Notice {
  switch (outcome.kind) {
    case 'succeeded':
      return { level: 'info', text: `Applied ${slug}.` };
    case 'awaiting-approval':
      return { level: 'info', text: `The change to ${slug} awaits approval.` };
    case 'blocked':
      return { level: 'warn', text: outcome.message.trim(), failure: outcome.failure };
    case 'failed':
      return { level: 'error', text: outcome.message.trim(), failure: outcome.failure };
    case 'cancelled':
      return { level: 'info', text: `Cancelled the apply of ${slug}.` };
    case 'detached':
      return outcome.submitted
        ? { level: 'warn', text: `Stopped following the apply of ${slug}; the run goes on.` }
        : { level: 'warn', text: `The apply of ${slug} stopped before it was sent; nothing ran.` };
  }
}

// A preview as a read-only document: the plan and the policy verdict.
export function previewText(preview: JsonOf<'stack preview'>): string {
  const { summary, human } = preview.plan;
  const { policy } = preview;
  return [
    `Preview of ${preview.stack.slug} (tree ${preview.treeHash})`,
    `Plan: +${summary.resourceAdd} ~${summary.resourceChange} -${summary.resourceDestroy}`,
    '',
    human,
    '',
    policy === null
      ? 'Policy: none applies'
      : `Policy: ${policy.mode} (${policy.policyId}, rule ${policy.ruleId}): ${policy.reason}${policy.rulesFired.length > 0 ? `\nRules fired: ${policy.rulesFired.join(', ')}` : ''}${policy.approvalMode === null ? '' : `\nApproval: ${policy.approvalMode}`}`,
    '',
  ].join('\n');
}
