// Lace: Add Module to Canvas: a quick pick over the module axis of the
// registry, on screen while the registry is read (`vscode/pick.ts`), then
// the same placement the sidebar's "+" runs. A registry that cannot be read
// closes the pick and says why, with the ways out its reason names; one
// with no module closes it and offers the publishing guide the list
// carries.
import type * as vscode from 'vscode';
import { documentOf, failureOf, failureText } from '../engine/command-outcome';
import { moduleKey, moduleLabel, type RegistryRow } from '../protocol/registry-protocol';
import { notice, type OfferActions, offersFor } from '../vscode/offers';
import { pickFrom } from '../vscode/pick';
import type { PlacedModule } from './place-module';
import type { RegistryReads } from './registry-reads';

export const ADD_MODULE = 'lace.addModuleToCanvas';

export type AddModuleApi = {
  window: Pick<
    typeof vscode.window,
    'createQuickPick' | 'showErrorMessage' | 'showWarningMessage' | 'showInformationMessage'
  >;
  env: Pick<typeof vscode.env, 'openExternal'>;
  Uri: Pick<typeof vscode.Uri, 'parse'>;
};

const PUBLISHING_GUIDE = 'How to publish a module';

export function addModuleToCanvas(options: {
  api: AddModuleApi;
  reads: Pick<RegistryReads, 'list'>;
  place: (module: PlacedModule) => Promise<void>;
  // What a notice about a registry that cannot be read offers.
  offers: OfferActions;
}): () => Promise<void> {
  const { api, reads, place, offers } = options;
  return async () => {
    const listed = reads.list().then((outcome) => documentOf('registry list', outcome));
    let picked: (vscode.QuickPickItem & { row: RegistryRow }) | undefined;
    try {
      picked = await pickFrom<vscode.QuickPickItem & { row: RegistryRow }>(
        api.window,
        listed.then(({ items, publishingGuideUrl }) => ({
          items: items.map((row: RegistryRow) => ({
            label: moduleLabel(row),
            description: `${moduleKey(row)} ${row.version}`,
            detail: row.description,
            row,
          })),
          none: () =>
            void api.window
              .showInformationMessage('No modules are published yet.', PUBLISHING_GUIDE)
              .then((answer) =>
                answer === PUBLISHING_GUIDE
                  ? api.env.openExternal(api.Uri.parse(publishingGuideUrl))
                  : undefined,
              ),
        })),
        { placeholder: 'Which module?', matchOnDescription: true, matchOnDetail: true },
      );
    } catch (error) {
      await notice(
        api,
        offers,
        'error',
        failureText(error, { kind: 'read', path: 'registry list' }),
        offersFor(failureOf(error)),
      );
      return;
    }
    if (!picked) return;
    const { author, name, version } = picked.row;
    await place({ author, name, version });
  };
}
