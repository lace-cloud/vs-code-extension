// What the window offers beside a notice. Beside a failed command's: one
// action per way out the failure's reason names, read from the failure
// document and never from the message; a reason with no way out the host
// can take offers nothing, and the message says what happened. A notice of
// the window's runner offers, after those, each package action that answers
// the failure (`FailureAnswer`, which the runner host binds to the failed
// run). Beside an apply held for approval: the held Run's page in the
// portal, and the page of each record a change-management system keeps of
// its change request, where the record carries one.
//
// Validate acts on a root: a notice that names the root the failure is
// about offers Validate on that root, the palette's Validate. A notice of
// the window's runner names the root its run's `RunCtx` names, when that
// root is under a workspace folder.
import type { CommandFailure, PresenterPort } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { type ByReason, byReason } from '../engine/command-outcome';
import type { RunnerPresenter } from '../engine/runner-host';
import { type AuthoringRoot, type RootSources, rootOfPath } from '../roots/authoring-roots';

export type Offer =
  | { kind: 'signIn' }
  | { kind: 'selectOrganization' }
  | { kind: 'selectTeam' }
  | { kind: 'validate' }
  // A page in the portal: where the missing thing is made, as the failure
  // carries it, or the held Run's, where its requirements are decided.
  | { kind: 'openPortal'; url: string }
  // The page a missing tool installs from, as the failure carries it.
  | { kind: 'install'; url: string }
  // The page of a change request's record in the change-management system
  // that keeps it; `record` names it as the system does, by kind and
  // reference.
  | { kind: 'openRecord'; record: string; url: string };

type OfferKind = Offer['kind'];
// The offers a failure's reason names.
type WayOut = Exclude<OfferKind, 'openRecord'>;

// Each reason with its ways out. `unauthenticated` is a command that needs
// credentials and has none; `source_refused` Terraform a command cannot
// represent as written, which the developer fixes and validates again;
// `tool_missing` a command that runs a tool the developer installs and the
// machine lacks (terraform-docs, for Generate Docs), named with the page it
// installs from; Lace does not install it. `not_git_repository` names no way out the host takes:
// the message says to run `git init`.
const OFFERS: ByReason<readonly WayOut[]> = {
  unauthenticated: ['signIn'],
  no_organization: ['selectOrganization'],
  no_team: ['selectTeam', 'openPortal'],
  no_certification: ['validate'],
  stale_certification: ['validate'],
  source_refused: ['validate'],
  tool_missing: ['install'],
};

export const OFFER_LABELS: Readonly<Record<WayOut, string>> = {
  signIn: 'Sign In',
  selectOrganization: 'Select Organization',
  selectTeam: 'Select Team',
  validate: 'Validate',
  openPortal: 'Open Portal',
  install: 'Install',
};

// An offer's button: its kind's label, or for a record, the record it opens.
function offerLabel(offer: Offer): string {
  return offer.kind === 'openRecord' ? `Open ${offer.record}` : OFFER_LABELS[offer.kind];
}

export function offersFor(failure: CommandFailure | undefined): Offer[] {
  if (!failure) return [];
  return (byReason(OFFERS, failure.reason) ?? []).flatMap((kind): Offer[] => {
    if (kind !== 'openPortal' && kind !== 'install') return [{ kind }];
    return failure.url === undefined ? [] : [{ kind, url: failure.url }];
  });
}

type OfferAction<K extends OfferKind> = (offer: Extract<Offer, { kind: K }>) => unknown;

// The window's actions for each way out, Validate only where a notice names
// its root.
export type OfferActions = { [K in Exclude<OfferKind, 'validate'>]: OfferAction<K> } & {
  validate?: OfferAction<'validate'>;
};

type NoticeApi = {
  window: Pick<
    typeof vscode.window,
    'showErrorMessage' | 'showWarningMessage' | 'showInformationMessage'
  >;
};

// Shows a notice at `level` with those of `offered` that `actions` can take
// and `extra` labels as its buttons; resolves with the label chosen. An
// offer chosen is run here.
export async function notice(
  api: NoticeApi,
  actions: OfferActions,
  level: 'info' | 'warn' | 'error',
  text: string,
  offered: readonly Offer[],
  extra: readonly string[] = [],
): Promise<string | undefined> {
  const offers = offered.filter((offer) => actions[offer.kind] !== undefined);
  const labels = [...offers.map(offerLabel), ...extra];
  const answer = await (level === 'error'
    ? api.window.showErrorMessage(text, ...labels)
    : level === 'warn'
      ? api.window.showWarningMessage(text, ...labels)
      : api.window.showInformationMessage(text, ...labels));
  const chosen = offers.find((offer) => offerLabel(offer) === answer);
  if (chosen) await (actions[chosen.kind] as (offer: Offer) => unknown)(chosen);
  return answer;
}

export type OfferingPresenterOptions = {
  api: NoticeApi;
  actions: OfferActions;
  confirm: NonNullable<PresenterPort['confirm']>;
  // Lace: Validate Module on a root.
  validate: (root: AuthoringRoot) => Promise<void>;
  sources: Pick<RootSources, 'folders'>;
  report: (what: string, error: unknown) => void;
};

// The presenter of the window's runner: each notice with its offers,
// Validate on the root of the run it is about among them, and after them
// the package actions that answer its failure, the one chosen run; and the
// typed confirmation a binding asks for.
export function offeringPresenter(options: OfferingPresenterOptions): RunnerPresenter {
  const { api, actions, confirm, validate, sources, report } = options;
  return (noticed) => ({
    notify: (level, text, failure) => {
      const run = noticed();
      const at = run?.ctx.root;
      const root = at === undefined ? undefined : rootOfPath(sources.folders(), at);
      const ways = root === undefined ? actions : { ...actions, validate: () => validate(root) };
      const answers = failure === undefined || run === undefined ? [] : run.answers(failure);
      const labels = answers.map(({ label }) => label);
      notice(api, ways, level, text, offersFor(failure), labels)
        .then((chosen) => answers.find(({ label }) => label === chosen)?.run())
        .catch((error) => report('acting on a Lace notice', error));
    },
    confirm,
  });
}
