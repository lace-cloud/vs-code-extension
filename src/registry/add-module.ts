// Lace: Add Module to Canvas: a quick pick over the module axis of the
// registry, then the same placement the sidebar's "+" runs.
import type * as vscode from 'vscode';
import { SIGN_IN } from '../account/account';
import { moduleKey, moduleLabel, type RegistryRow } from '../protocol/registry-protocol';
import type { PlacedModule } from './place-module';
import type { RegistryReads } from './registry-reads';

export const ADD_MODULE = 'lace.addModuleToCanvas';

export type AddModuleApi = {
  window: Pick<
    typeof vscode.window,
    'showQuickPick' | 'showErrorMessage' | 'showInformationMessage' | 'withProgress'
  >;
  commands: Pick<typeof vscode.commands, 'executeCommand'>;
  env: Pick<typeof vscode.env, 'openExternal'>;
  Uri: Pick<typeof vscode.Uri, 'parse'>;
  ProgressLocation: Pick<typeof vscode.ProgressLocation, 'Window'>;
};

const SIGN_IN_ACTION = 'Sign In';
const PUBLISHING_GUIDE = 'How to publish a module';

export function addModuleToCanvas(options: {
  api: AddModuleApi;
  reads: Pick<RegistryReads, 'list'>;
  place: (module: PlacedModule) => Promise<void>;
}): () => Promise<void> {
  const { api, reads, place } = options;
  return async () => {
    const list = await api.window.withProgress(
      { location: api.ProgressLocation.Window, title: 'Lace: reading the registry' },
      () => reads.list(),
    );
    if (list.kind === 'failure') {
      if (list.failure.reason !== 'unauthenticated') {
        void api.window.showErrorMessage(list.failure.message);
        return;
      }
      const answer = await api.window.showErrorMessage(
        'Sign in to browse the Lace registry.',
        SIGN_IN_ACTION,
      );
      if (answer === SIGN_IN_ACTION) await api.commands.executeCommand(SIGN_IN);
      return;
    }
    const { items, publishingGuideUrl } = list.document;
    if (items.length === 0) {
      const answer = await api.window.showInformationMessage(
        'No modules are published yet.',
        PUBLISHING_GUIDE,
      );
      if (answer === PUBLISHING_GUIDE)
        await api.env.openExternal(api.Uri.parse(publishingGuideUrl));
      return;
    }
    const picked = await api.window.showQuickPick(
      items.map((row: RegistryRow) => ({
        label: moduleLabel(row),
        description: `${moduleKey(row)} ${row.version}`,
        detail: row.description,
        row,
      })),
      { placeHolder: 'Which module?', matchOnDescription: true, matchOnDetail: true },
    );
    if (!picked) return;
    const { author, name, version } = picked.row;
    await place({ author, name, version });
  };
}
