// The answerer of the window's runner: the VS Code prompt that asks for each
// argument a package binding leaves to its host, by the argument's name, in
// the order the form lists them. A prompt's words are about its argument
// alone; its title is the run's (`runTitle`), the action and what the run
// acts on, the title its progress carries too. A dismissed prompt cancels
// the form. The runner host reuses what a run's context was answered
// before, so a form asks only what that context never answered.
//
//   slug        an input box that refuses an empty value; the slug's own
//               rule is the CLI's and the API's
//   connection  a pick of the team's cloud connections (`lace connection
//               list`, in the home), each as the CLI reports it, on screen
//               while the list is read (`pick.ts`). A list that cannot be
//               read closes the pick, cancels the form and says why, with
//               the ways out its reason names; an empty one closes it,
//               cancels the form and says a connection is added in the
//               portal, with Open Portal on the page the list names
//               (`createUrl`)
//   state       an open dialog for one statefile of any name, opened at the
//               root the run names
//
// An argument with no prompt here cancels the form, and the notice says
// this window cannot ask for it.
import type { ActionContribution, RunCtx } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { commandDocument, failureOf, failureText } from '../engine/command-outcome';
import type { CommandsMapping } from '../engine/commands-mapping';
import type { Answerer, Form } from '../engine/runner-host';
import { type AuthoringRoot, type RootSources, rootOfRun, rootUri } from '../roots/authoring-roots';
import { notice, type OfferActions, offersFor } from './offers';
import { pickFrom } from './pick';
import { runTitle } from './run-progress';

export type FormAnswererOptions = {
  api: {
    window: Pick<
      typeof vscode.window,
      | 'showInputBox'
      | 'createQuickPick'
      | 'showOpenDialog'
      | 'showInformationMessage'
      | 'showWarningMessage'
      | 'showErrorMessage'
    >;
  };
  commands: Pick<CommandsMapping, 'anywhere'>;
  // What a notice about a failed read offers.
  offers: OfferActions;
  sources: Pick<RootSources, 'folders'>;
  report: (what: string, error: unknown) => void;
};

// What a prompt asks with: its title, and the authoring root its run acts
// on, when the root is under a workspace folder.
type Asking = { title: string; root: AuthoringRoot | undefined };

// The value a prompt was given, or undefined when the form is cancelled.
type Prompt = (asking: Asking) => Promise<string | undefined>;

const NO_CONNECTION = 'The team has no cloud connection yet. Add one in the portal.';

export function formAnswerer(options: FormAnswererOptions): Answerer {
  const { api, commands, offers, sources, report } = options;

  const shown = (said: Promise<unknown>) =>
    said.catch((error) => report('acting on a Lace notice', error));

  const PROMPTS: Readonly<Record<string, Prompt>> = {
    slug: async ({ title }) =>
      api.window.showInputBox({
        title,
        prompt: 'The slug',
        validateInput: (value) => (value === '' ? 'Type the slug' : undefined),
      }),
    connection: async ({ title }) => {
      const listed = commands
        .anywhere()
        .then((home) => commandDocument(home, 'connection list', {}));
      try {
        const picked = await pickFrom(
          api.window,
          listed.then(({ items, createUrl }) => ({
            items: items.map((connection) => ({
              label: connection.name,
              description: `${connection.provider_type} · ${connection.status} · ${connection.id}`,
              id: connection.id,
            })),
            none: () =>
              shown(
                notice(api, offers, 'info', NO_CONNECTION, [
                  { kind: 'openPortal', url: createUrl },
                ]),
              ),
          })),
          { title, placeholder: 'The cloud connection' },
        );
        return picked?.id;
      } catch (error) {
        shown(
          notice(
            api,
            offers,
            'error',
            failureText(error, { kind: 'read', path: 'connection list' }),
            offersFor(failureOf(error)),
          ),
        );
        return undefined;
      }
    },
    state: async ({ title, root }) => {
      const picked = await api.window.showOpenDialog({
        title,
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Select Statefile',
        ...(root === undefined ? {} : { defaultUri: rootUri(root) }),
      });
      return picked?.[0]?.fsPath;
    },
  };

  // What the prompts of a run of `action` over `ctx` ask with.
  function asking(action: ActionContribution, ctx: RunCtx): Asking {
    const folders = sources.folders();
    const root = rootOfRun(folders, ctx);
    return { title: runTitle(action, ctx, root, folders), root };
  }

  async function answer(form: Form, action: ActionContribution, ctx: RunCtx): Promise<void> {
    const unasked = form.missing.filter((name) => !Object.hasOwn(PROMPTS, name));
    if (unasked.length > 0) {
      form.cancel();
      void api.window.showWarningMessage(
        `${action.label} needs ${unasked.join(', ')}, which this window cannot ask for`,
      );
      return;
    }
    const ask = asking(action, ctx);
    const values: Record<string, string> = {};
    for (const name of form.missing) {
      const value = await PROMPTS[name](ask);
      if (value === undefined) {
        form.cancel();
        return;
      }
      values[name] = value;
    }
    form.submit(values);
  }

  return (form, { action, ctx }) => {
    answer(form, action, ctx).catch((error) => {
      form.cancel();
      report(`asking for what ${action.label} needs`, error);
    });
  };
}
