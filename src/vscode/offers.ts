// What the window offers beside a failed command's notice: one action per
// way out the failure's reason names, read from the failure document and
// never from the message. A reason with no way out the host can take offers
// nothing; the message says what happened.
//
// Validate acts on a root: a notice offers it only when the place that shows
// the notice names the root the failure is about and supplies the action, the
// palette's Validate on that root. A notice of the window's runner names no
// run (`PresenterPort.notify` carries no context), so it offers no Validate.
import type { CommandFailure, PresenterPort } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { type ByReason, byReason } from '../engine/command-outcome';

export type Offer =
  | { kind: 'signIn' }
  | { kind: 'selectOrganization' }
  | { kind: 'selectTeam' }
  | { kind: 'validate' }
  // The page where the missing thing is made, as the failure carries it.
  | { kind: 'openPortal'; url: string }
  // The page a missing tool installs from, as the failure carries it.
  | { kind: 'install'; url: string };

type OfferKind = Offer['kind'];

// Each reason with its ways out. `unauthenticated` is a command that needs
// credentials and has none; `source_refused` Terraform a command cannot
// represent as written, which the developer fixes and validates again;
// `tool_missing` a command that runs a tool the developer installs and the
// machine lacks (terraform-docs, for Generate Docs), named with the page it
// installs from; Lace does not install it. `not_git_repository` names no way out the host takes:
// the message says to run `git init`.
const OFFERS: ByReason<readonly OfferKind[]> = {
  unauthenticated: ['signIn'],
  no_organization: ['selectOrganization'],
  no_team: ['selectTeam', 'openPortal'],
  no_certification: ['validate'],
  stale_certification: ['validate'],
  source_refused: ['validate'],
  tool_missing: ['install'],
};

export const OFFER_LABELS: Readonly<Record<OfferKind, string>> = {
  signIn: 'Sign In',
  selectOrganization: 'Select Organization',
  selectTeam: 'Select Team',
  validate: 'Validate',
  openPortal: 'Open Portal',
  install: 'Install',
};

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

// Shows a notice at `level` with the failure's offers that `actions` can
// take and `extra` labels as its buttons; resolves with the label chosen. An
// offer chosen is run here.
export async function notice(
  api: NoticeApi,
  actions: OfferActions,
  level: 'info' | 'warn' | 'error',
  text: string,
  failure: CommandFailure | undefined,
  extra: readonly string[] = [],
): Promise<string | undefined> {
  const offers = offersFor(failure).filter((offer) => actions[offer.kind] !== undefined);
  const labels = [...offers.map((offer) => OFFER_LABELS[offer.kind]), ...extra];
  const answer = await (level === 'error'
    ? api.window.showErrorMessage(text, ...labels)
    : level === 'warn'
      ? api.window.showWarningMessage(text, ...labels)
      : api.window.showInformationMessage(text, ...labels));
  const chosen = offers.find((offer) => OFFER_LABELS[offer.kind] === answer);
  if (chosen) await (actions[chosen.kind] as (offer: Offer) => unknown)(chosen);
  return answer;
}

// The presenter of the window's runner: each notice with its offers, and the
// typed confirmation a binding asks for.
export function offeringPresenter(
  api: NoticeApi,
  actions: OfferActions,
  confirm: NonNullable<PresenterPort['confirm']>,
  report: (what: string, error: unknown) => void,
): PresenterPort {
  return {
    notify: (level, text, failure) => {
      notice(api, actions, level, text, failure).catch((error) =>
        report('acting on a Lace notice', error),
      );
    },
    confirm,
  };
}
