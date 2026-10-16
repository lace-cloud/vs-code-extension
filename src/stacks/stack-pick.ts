// The one pick of a stack deployed from an authoring root, for a stack
// command that no stack row names (the palette's Preview, Apply and Scan,
// Import Existing Resources): a pick among the stacks `lace stack list
// --source <root>` lists, the one picked for the root's canvas marked, on
// screen while the list is read (`vscode/pick.ts`). A list that cannot be
// read closes the pick and says why, with the ways out its reason names. A
// root with no stack closes it and says so and where one is created, the
// Stacks view.
import type { StackRef } from '@lace-cloud/canvas/engine';
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
import { pickFrom } from '../vscode/pick';
import { stackRef } from './stack-rows';

// A stack of `root` the developer picks to `verb`; undefined when there is
// none to pick, or the pick was dismissed.
export type PickStack = (root: AuthoringRoot, verb: string) => Promise<StackRef | undefined>;

export type StackPickOptions = {
  api: {
    window: Pick<
      typeof vscode.window,
      'createQuickPick' | 'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage'
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
    const listed = commands
      .anywhere()
      .then((home) => commandDocument(home, 'stack list', { source: rootPath(root) }));
    try {
      const chosen = await pickFrom(
        api.window,
        listed.then(({ items }) => {
          const picked = rootState.stack(root)?.id;
          return {
            items: items.map((stack) => ({
              label: stack.name,
              description: stack.id === picked ? `${stack.slug} · on the canvas` : stack.slug,
              stack,
            })),
            none: () =>
              void api.window.showInformationMessage(
                `No stack is deployed from ${label} yet. Create one in the Stacks view.`,
              ),
          };
        }),
        { placeholder: `The stack deployed from ${label} to ${verb}` },
      );
      return chosen && stackRef(chosen.stack);
    } catch (error) {
      await notice(api, offers, 'error', failureText(error), offersFor(failureOf(error)));
      return undefined;
    }
  };
}
