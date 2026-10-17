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
//
// Signing out's notice is the fate of the API key the machine held, from
// `lace logout`'s result: revoked, not revoked and why, or that none was
// saved. When the key may still be live (the result names the portal page
// where it is revoked), the notice is a warning and Open Portal opens that
// page.
import {
  CommandExitError,
  type CommandsPort,
  failureSays,
  type JsonOf,
} from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { commandDocument } from '../engine/command-outcome';
import { OFFER_LABELS } from '../vscode/offers';

export type SignInApi = {
  window: Pick<
    typeof vscode.window,
    'withProgress' | 'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage'
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
      const invocation = commands.invoke('login', {}, new AbortController().signal);
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
          void api.window.showErrorMessage(`Lace sign-in failed: ${failureSays(error).message}`);
        }
        return undefined;
      } finally {
        cancelling.dispose();
      }
    },
  );
}

type SignedOut = JsonOf<'logout'>;

// What became of the key `lace logout` ended, by the result's `revocation`.
const KEY_FATE: Readonly<Record<SignedOut['revocation'], string>> = {
  revoked: "Signed out of Lace. This machine's API key is revoked and its credentials removed",
  refused:
    'Signed out of Lace. The credentials are removed from this machine, but Lace did not revoke the API key',
  unreachable:
    'Signed out of Lace. The credentials are removed from this machine, but Lace could not be reached to revoke the API key',
  unreadable:
    'Signed out of Lace. The credentials are removed from this machine; they could not be read, so their API key was not revoked',
  none: 'You were not signed in to Lace: no credentials were saved on this machine',
};

const sentence = (text: string): string => (text.endsWith('.') ? text : `${text}.`);

// What a sign-out says: the key's fate, with why it was not revoked when the
// result says, and, when the key may still be live, where it is revoked.
function signedOutText({ revocation, detail, portalUrl }: SignedOut): string {
  const fate = sentence(
    detail === undefined ? KEY_FATE[revocation] : `${KEY_FATE[revocation]}: ${detail}`,
  );
  return portalUrl === undefined
    ? fate
    : `${fate} The key may still be live. Revoke it in the portal under Account, CLI keys.`;
}

// Runs `lace logout` and says what became of the machine's key. It resolves
// with the notice on screen, not waiting on the developer's answer, so the
// sign-out is announced at once.
export async function signOut(
  commands: CommandsPort,
  api: Pick<SignInApi, 'env' | 'Uri'> & {
    window: Pick<typeof vscode.window, 'showInformationMessage' | 'showWarningMessage'>;
  },
): Promise<void> {
  const result = await commandDocument(commands, 'logout', {});
  const said = signedOutText(result);
  const { portalUrl } = result;
  if (portalUrl === undefined) {
    void api.window.showInformationMessage(said);
    return;
  }
  void api.window.showWarningMessage(said, OFFER_LABELS.openPortal).then((answer) => {
    if (answer === OFFER_LABELS.openPortal) void api.env.openExternal(api.Uri.parse(portalUrl));
  });
}
