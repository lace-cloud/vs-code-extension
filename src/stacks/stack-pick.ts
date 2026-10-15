// The one pick of a stack deployed from an authoring root, for a stack
// command that no stack row names (the palette's Preview, Apply and Scan,
// Import Existing Resources): a pick among the stacks `lace stack list
// --source <root>` lists, the one picked for the root's canvas marked. A
// list that cannot be read says why, with the ways out its reason names. A
// root with no stack says so and where one is created, the Stacks view, and
// shows no empty pick.
import type { JsonOf, StackRef } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { commandDocument, failureOf, failureText } from '../engine/command-outcome';
import type { CommandsMapping } from '../engine/commands-mapping';
import {
  type AuthoringRoot,
  type RootSources,
  rootLabel,
  rootPath,
} from '../roots/authoring-roots';
import type { RootState } from '../state/root-state';
import { notice, type OfferActions, offersFor } from '../vscode/offers';
import { stackRef } from './stack-rows';

// A stack of `root` the developer picks to `verb`; undefined when there is
// none to pick, or the pick was dismissed.
export type PickStack = (root: AuthoringRoot, verb: string) => Promise<StackRef | undefined>;

export type StackPickOptions = {
  api: {
    window: Pick<
      typeof vscode.window,
      'showQuickPick' | 'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage'
    >;
  };
  commands: Pick<CommandsMapping, 'anywhere'>;
  rootState: Pick<RootState, 'stack'>;
  sources: Pick<RootSources, 'folders'>;
  // What a notice about a list that cannot be read offers.
  offers: OfferActions;
};

export function stackPick(options: StackPickOptions): PickStack {
  const { api, commands, rootState, sources, offers } = options;
  return async (root, verb) => {
    const label = rootLabel(root, sources.folders());
    let listed: JsonOf<'stack list'>;
    try {
      listed = await commandDocument(await commands.anywhere(), 'stack list', {
        source: rootPath(root),
      });
    } catch (error) {
      await notice(api, offers, 'error', failureText(error), offersFor(failureOf(error)));
      return undefined;
    }
    if (listed.items.length === 0) {
      void api.window.showInformationMessage(
        `No stack is deployed from ${label} yet. Create one in the Stacks view.`,
      );
      return undefined;
    }
    const picked = rootState.stack(root)?.id;
    const chosen = await api.window.showQuickPick(
      listed.items.map((stack) => ({
        label: stack.name,
        description: stack.id === picked ? `${stack.slug} · on the canvas` : stack.slug,
        stack,
      })),
      { placeHolder: `The stack deployed from ${label} to ${verb}` },
    );
    return chosen && stackRef(chosen.stack);
  };
}
