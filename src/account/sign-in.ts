// Signing in and out: `lace login` and `lace logout`, run through the
// engine like any command. Whether the developer is signed in is the CLI's
// to say: the extension keeps nothing of it, and the engine reads the
// credentials for each command.
//
// The browser sign-in streams a confirmation code and the page to type it
// on; the device flow streams its code with the provider's page. The code is
// shown once, beside a way to copy it, and each page is opened once. The
// sign-in waits on the person in the browser, under a progress notification
// whose Cancel withdraws it.
import {
  CommandExitError,
  type CommandsPort,
  failureSays,
  type JsonOf,
} from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { commandDocument } from '../engine/command-outcome';
import { LACE_COMMANDS } from '../engine/lace-commands';

export type SignInApi = {
  window: Pick<
    typeof vscode.window,
    'withProgress' | 'showInformationMessage' | 'showErrorMessage'
  >;
  env: {
    openExternal: (uri: vscode.Uri) => Thenable<boolean>;
    clipboard: Pick<vscode.Clipboard, 'writeText'>;
  };
  Uri: Pick<typeof vscode.Uri, 'parse'>;
  ProgressLocation: Pick<typeof vscode.ProgressLocation, 'Notification'>;
};

// The exit of a command the person cancelled.
const CANCELLED = 130;
const COPY_CODE = 'Copy Code';

type LoginEvent = JsonOf<'login'>;
type SignedIn = Extract<LoginEvent, { type: 'result' }>['user'];

// Runs `lace login`; resolves with who signed in, or undefined when the
// sign-in was cancelled or failed (which it says).
export async function signIn(
  commands: CommandsPort,
  api: SignInApi,
): Promise<SignedIn | undefined> {
  const shown = new Set<string>();
  const once = (value: string, show: () => void) => {
    if (shown.has(value)) return;
    shown.add(value);
    show();
  };
  const open = (url: string) => once(url, () => void api.env.openExternal(api.Uri.parse(url)));
  const showCode = (code: string) =>
    once(code, () => {
      void api.window
        .showInformationMessage(
          `Your Lace sign-in code is ${code}. Type it on the page that opened in your browser.`,
          COPY_CODE,
        )
        .then((answer) => {
          if (answer === COPY_CODE) void api.env.clipboard.writeText(code);
        });
    });

  return api.window.withProgress(
    {
      location: api.ProgressLocation.Notification,
      title: 'Signing in to Lace',
      cancellable: true,
    },
    async (progress, token) => {
      const invocation = commands.invoke(
        LACE_COMMANDS.login.path,
        {},
        new AbortController().signal,
      );
      const cancelling = token.onCancellationRequested(() => void invocation.cancel());
      try {
        let user: SignedIn | undefined;
        for await (const event of invocation.events) {
          if (event.type === 'code') {
            showCode(event.code);
            if (event.verificationUrl !== undefined) open(event.verificationUrl);
            progress.report({ message: 'waiting for you to finish in the browser' });
          } else if (event.type === 'url') {
            open(event.url);
          } else if (event.type === 'email_sent') {
            progress.report({ message: `open the link sent to ${event.email}` });
          } else {
            user = event.user;
          }
        }
        if (user) {
          void api.window.showInformationMessage(
            `Signed in to Lace as ${user.name} (${user.email}).`,
          );
        }
        return user;
      } catch (error) {
        if (!(error instanceof CommandExitError && error.code === CANCELLED)) {
          void api.window.showErrorMessage(
            `Lace sign-in failed: ${failureSays(error, LACE_COMMANDS.login).message}`,
          );
        }
        return undefined;
      } finally {
        cancelling.dispose();
      }
    },
  );
}

// Runs `lace logout`.
export async function signOut(
  commands: CommandsPort,
  window: Pick<typeof vscode.window, 'showInformationMessage'>,
): Promise<void> {
  const { loggedOut } = await commandDocument(commands, LACE_COMMANDS.logout, {});
  void window.showInformationMessage(
    loggedOut ? 'Signed out of Lace.' : 'You were not signed in to Lace.',
  );
}
