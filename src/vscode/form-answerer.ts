// The answerer of the window's runner: the VS Code prompt that asks for each
// argument a package binding leaves to its host, by the argument's name, in
// the order the form lists them. Each prompt is titled by the action and
// what its run acts on: the stack, else the authoring root. A dismissed
// prompt cancels the form. The runner host reuses what a run's context was
// answered before, so a form asks only what that context never answered.
//
//   slug        an input box that refuses an empty value; the slug's own
//               rule is the CLI's and the API's
//   connection  a pick of the team's cloud connections (`lace connection
//               list`, in the home), each as the CLI reports it. A list that
//               cannot be read cancels the form and says why, with the ways
//               out its reason names; an empty one cancels it and says a
//               connection is added in the portal, with Open Portal on the
//               page the list names (`createUrl`)
//   state       an open dialog for one file of any name, opened at the
//               authoring root
//
// An argument with no prompt here cancels the form, and the notice says
// this window cannot ask for it.
import type { JsonOf, RunCtx } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { commandDocument, failureOf, failureText } from '../engine/command-outcome';
import type { CommandsMapping } from '../engine/commands-mapping';
import type { Answerer } from '../engine/runner-host';
import {
  type AuthoringRoot,
  type RootSources,
  rootLabel,
  rootOfPath,
  rootUri,
} from '../roots/authoring-roots';
import { notice, type OfferActions, offersFor } from './offers';

export type FormAnswererOptions = {
  api: {
    window: Pick<
      typeof vscode.window,
      | 'showInputBox'
      | 'showQuickPick'
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

const NO_CONNECTION =
  'The team has no cloud connection yet. Add one in the portal, then create the stack.';

export function formAnswerer(options: FormAnswererOptions): Answerer {
  const { api, commands, offers, sources, report } = options;

  const shown = (said: Promise<unknown>) =>
    said.catch((error) => report('acting on a Lace notice', error));

  const PROMPTS: Readonly<Record<string, Prompt>> = {
    slug: async ({ title }) =>
      api.window.showInputBox({
        title,
        prompt: "The new stack's slug",
        validateInput: (value) => (value === '' ? "Type the stack's slug" : undefined),
      }),
    connection: async ({ title }) => {
      let listed: JsonOf<'connection list'>;
      try {
        listed = await commandDocument(await commands.anywhere(), 'connection list', {});
      } catch (error) {
        shown(notice(api, offers, 'error', failureText(error), offersFor(failureOf(error))));
        return undefined;
      }
      if (listed.items.length === 0) {
        shown(
          notice(api, offers, 'info', NO_CONNECTION, [
            { kind: 'openPortal', url: listed.createUrl },
          ]),
        );
        return undefined;
      }
      const picked = await api.window.showQuickPick(
        listed.items.map((connection) => ({
          label: connection.name,
          description: `${connection.provider_type} · ${connection.status} · ${connection.id}`,
          id: connection.id,
        })),
        { title, placeHolder: 'The cloud connection the stack deploys through' },
      );
      return picked?.id;
    },
    state: async ({ title, root }) => {
      const picked = await api.window.showOpenDialog({
        title,
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        ...(root === undefined ? {} : { defaultUri: rootUri(root) }),
      });
      return picked?.[0]?.fsPath;
    },
  };

  // The prompts' title: the action, and the stack its run acts on, else the
  // authoring root by its name in the workspace.
  function asking(label: string, ctx: RunCtx): Asking {
    const folders = sources.folders();
    const root = ctx.root === undefined ? undefined : rootOfPath(folders, ctx.root);
    const subject = ctx.stack?.slug ?? (root === undefined ? ctx.root : rootLabel(root, folders));
    return { title: subject === undefined ? label : `${label}: ${subject}`, root };
  }

  async function answer(form: Parameters<Answerer>[0], label: string, ctx: RunCtx): Promise<void> {
    const unasked = form.missing.filter((name) => !Object.hasOwn(PROMPTS, name));
    if (unasked.length > 0) {
      form.cancel();
      void api.window.showWarningMessage(
        `${label} needs ${unasked.join(', ')}, which this window cannot ask for`,
      );
      return;
    }
    const ask = asking(label, ctx);
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
    answer(form, action.label, ctx).catch((error) => {
      form.cancel();
      report(`asking for what ${action.label} needs`, error);
    });
  };
}
