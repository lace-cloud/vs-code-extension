// The account, as the window sees it: signing in and out, and the
// organization and team scoped commands run in, each run as the CLI's own
// command through the engine from the developer's home directory. Nothing
// of it is kept here but the last read to compare the next with; a change
// is announced so the views that read the account read again.
//
// A terminal or another window can change the account too: `lace login`,
// `lace logout`, `lace org use`. So the account is read again each time the
// window regains focus (a terminal outside it) and each time a `lace`
// command line ends in one of its integrated terminals (which changes no
// focus), and a read that differs from the last one is announced: who is
// signed in (`whoami`'s user, or the reason it gives for none), the
// organization and the team.
import type { CommandsPort } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { commandOutcome, failureOf, failureText } from '../engine/command-outcome';
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
  // `listener` is called after each sign-in, sign-out or saved selection
  // this window makes, and when a read finds the account changed outside it.
  onDidChange: (listener: () => void) => () => void;
  dispose: () => void;
};

export type AccountApi = SignInApi &
  ScopeApi & {
    window: Pick<typeof vscode.window, 'onDidChangeWindowState' | 'onDidEndTerminalShellExecution'>;
  };

// A command line that runs the `lace` CLI, named bare or by its path.
const LACE_COMMAND = /^(?:\S*[/\\])?lace(?:\.exe)?(?:\s|$)/;

// The account as the CLI reads it, as one value two reads are compared by.
async function accountRead(commands: CommandsPort): Promise<string> {
  const [who, selection] = await Promise.all([
    commandOutcome(commands, 'whoami', {}),
    currentSelection(commands),
  ]);
  const signedIn = who.kind === 'result' ? who.document.user.id : who.failure.reason;
  return JSON.stringify({ signedIn, ...selection });
}

export function createAccount(
  commands: CommandsMapping,
  api: AccountApi,
  report: (what: string, error: unknown) => void,
): Account {
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };

  // The account as last read, and each read's turn: a read is kept only
  // while no later one started.
  let last: string | undefined;
  let reading = 0;
  // Reads the account and keeps it; resolves whether it differs from the
  // read kept before it, when there was one.
  async function read(): Promise<boolean> {
    const turn = ++reading;
    const now = await accountRead(await commands.anywhere());
    if (turn !== reading) return false;
    const differs = last !== undefined && now !== last;
    last = now;
    return differs;
  }
  const failed = (error: unknown) => report('reading the Lace account', error);
  // The account may have changed outside this window.
  const readAgain = () =>
    read().then((differs) => {
      if (differs) changed();
    }, failed);
  // A change this window made: announced, then read as it is now, the read
  // the next one is compared with.
  const madeHere = () => {
    changed();
    void read().catch(failed);
  };

  void read().catch(failed);
  const focus = api.window.onDidChangeWindowState((state) => {
    if (state.focused) void readAgain();
  });
  const terminal = api.window.onDidEndTerminalShellExecution(({ execution }) => {
    if (LACE_COMMAND.test(execution.commandLine.value.trimStart())) void readAgain();
  });

  return {
    async signIn() {
      if (await signIn(await commands.anywhere(), api)) madeHere();
    },
    async signOut() {
      await signOut(await commands.anywhere(), api.window);
      madeHere();
    },
    async selectOrganization() {
      if (await selectOrganization(await commands.anywhere(), api)) madeHere();
    },
    async selectTeam() {
      if (await selectTeam(await commands.anywhere(), api)) madeHere();
    },
    onDidChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      focus.dispose();
      terminal.dispose();
    },
  };
}

type ControlsApi = Parameters<typeof registerCommands>[0] & {
  window: Pick<
    typeof vscode.window,
    'createStatusBarItem' | 'showErrorMessage' | 'showWarningMessage' | 'showInformationMessage'
  >;
};

// The account's palette commands, and the status bar item showing the
// selection: read when the feature starts and at each change of the
// account, made in this window or found outside it. A command that fails
// says why with the ways out its failure names: Sign In for a command that
// needs credentials, Select Organization for a team pick with none selected.
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
  // A failure is said for the command of the flow that failed, a read or a
  // write (`CommandFailedError`).
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
      status.dispose();
      for (const command of registered) command.dispose();
    },
  };
}
