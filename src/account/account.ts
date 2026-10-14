// The account, as the window sees it: signing in and out, and the
// organization and team scoped commands run in, each run as the CLI's own
// command through the engine from the developer's home directory. Nothing
// is kept here; a change is announced so the views that read it read again.
import type * as vscode from 'vscode';
import { failureOf, failureText } from '../engine/command-outcome';
import type { CommandsMapping } from '../engine/commands-mapping';
import { registerCommands } from '../vscode/commands';
import { notice, type OfferActions, offersFor } from '../vscode/offers';
import {
  currentSelection,
  type ScopeApi,
  selectionStatus,
  selectOrganization,
  selectTeam,
} from './scope';
import { type SignInApi, signIn, signOut } from './sign-in';

export const SIGN_IN = 'lace.signIn';
export const SIGN_OUT = 'lace.signOut';
export const SELECT_ORGANIZATION = 'lace.selectOrganization';
export const SELECT_TEAM = 'lace.selectTeam';

export type Account = {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  selectOrganization: () => Promise<void>;
  selectTeam: () => Promise<void>;
  // `listener` is called after each sign-in, sign-out or saved selection.
  onDidChange: (listener: () => void) => () => void;
};

export type AccountApi = SignInApi & ScopeApi;

export function createAccount(commands: CommandsMapping, api: AccountApi): Account {
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    async signIn() {
      if (await signIn(await commands.anywhere(), api)) changed();
    },
    async signOut() {
      await signOut(await commands.anywhere(), api.window);
      changed();
    },
    async selectOrganization() {
      if (await selectOrganization(await commands.anywhere(), api)) changed();
    },
    async selectTeam() {
      if (await selectTeam(await commands.anywhere(), api)) changed();
    },
    onDidChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type ControlsApi = Parameters<typeof registerCommands>[0] & {
  window: Pick<
    typeof vscode.window,
    | 'createStatusBarItem'
    | 'onDidChangeWindowState'
    | 'showErrorMessage'
    | 'showWarningMessage'
    | 'showInformationMessage'
  >;
};

// The account's palette commands, and the status bar item showing the
// selection: read when the feature starts, after each change, and when the
// window regains focus, since a terminal or another window can change it. A
// command that fails says why with the ways out its failure names: Sign In
// for a command that needs credentials, Select Organization for a team
// pick with none selected.
export function accountControls(
  api: ControlsApi,
  account: Account,
  commands: CommandsMapping,
  offers: OfferActions,
  report: (what: string, error: unknown) => void,
): vscode.Disposable {
  const status = api.window.createStatusBarItem();
  status.command = SELECT_ORGANIZATION;
  const refresh = async () => {
    try {
      const { text, tooltip } = selectionStatus(await currentSelection(await commands.anywhere()));
      status.text = text;
      status.tooltip = tooltip;
      status.show();
    } catch (error) {
      status.hide();
      report('reading the Lace organization and team', error);
    }
  };
  void refresh();
  const offChange = account.onDidChange(() => void refresh());
  const focus = api.window.onDidChangeWindowState((state) => {
    if (state.focused) void refresh();
  });
  const offering = (act: () => Promise<void>) => async () => {
    try {
      await act();
    } catch (error) {
      await notice(api, offers, 'error', failureText(error), offersFor(failureOf(error)));
    }
  };
  const registered = registerCommands(api, {
    [SIGN_IN]: () => account.signIn(),
    [SIGN_OUT]: offering(() => account.signOut()),
    [SELECT_ORGANIZATION]: offering(() => account.selectOrganization()),
    [SELECT_TEAM]: offering(() => account.selectTeam()),
  });
  return {
    dispose() {
      offChange();
      focus.dispose();
      status.dispose();
      for (const command of registered) command.dispose();
    },
  };
}
