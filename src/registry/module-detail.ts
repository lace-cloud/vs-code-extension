// Module detail: one webview panel per module, in its kept design, drawn by
// the module-detail page from the state this host sends. Opening it starts
// two reads: `registry get` for the record — its README, its versions —
// and `registry describe` of the version the row shows for the interface,
// which downloads and certifies that version, so it settles later and can
// be refused. Add to Canvas places the version the page names.
import type * as vscode from 'vscode';
import {
  type DetailState,
  detailMessageOf,
  moduleKey,
  moduleLabel,
  type RegistryRow,
  type ToPage,
} from '../protocol/registry-protocol';
import { pageHtml } from '../vscode/webview-html';
import type { PlacedModule } from './place-module';
import { asRead, type RegistryReads } from './registry-reads';

export const MODULE_DETAIL_VIEW_TYPE = 'lace.moduleDetail';

export type ModuleDetailApi = {
  window: Pick<typeof vscode.window, 'createWebviewPanel'>;
  ViewColumn: Pick<typeof vscode.ViewColumn, 'Active'>;
};

export type ModuleDetailOptions = {
  api: ModuleDetailApi;
  extensionUri: vscode.Uri;
  reads: Pick<RegistryReads, 'get' | 'describe'>;
  place: (module: PlacedModule) => Promise<void>;
  report: (what: string, error: unknown) => void;
};

export type ModuleDetailPanels = {
  // Opens the module's panel, or reveals it.
  show: (row: RegistryRow) => void;
  dispose: () => void;
};

export function createModuleDetailPanels(options: ModuleDetailOptions): ModuleDetailPanels {
  const { api, reads, place, report } = options;
  const open = new Map<string, vscode.WebviewPanel>();
  const out = options.extensionUri.with({ path: `${options.extensionUri.path}/out` });

  function create(row: RegistryRow): vscode.WebviewPanel {
    const key = moduleKey(row);
    const panel = api.window.createWebviewPanel(
      MODULE_DETAIL_VIEW_TYPE,
      moduleLabel(row),
      api.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [out] },
    );
    let state: DetailState = { row, record: { kind: 'loading' }, describe: { kind: 'loading' } };
    let disposed = false;
    const post = (): void => {
      if (disposed) return;
      void panel.webview.postMessage({ op: 'state', state } satisfies ToPage<DetailState>);
    };

    panel.webview.onDidReceiveMessage((raw) => {
      const message = detailMessageOf(raw);
      if (message?.op === 'ready') post();
      if (message?.op === 'place') {
        place({ author: row.author, name: row.name, version: message.version }).catch((error) =>
          report(`adding ${key} to a canvas`, error),
        );
      }
    });
    panel.onDidDispose(() => {
      disposed = true;
      open.delete(key);
    });
    panel.webview.html = pageHtml(
      {
        outUri: (file) => panel.webview.asWebviewUri(out.with({ path: `${out.path}/${file}` })),
        cspSource: panel.webview.cspSource,
        title: moduleLabel(row),
      },
      { bundle: 'module-detail', images: ['https:', 'data:'] },
    );

    void asRead(
      () => reads.get(key),
      (error) => report(`reading ${key} from the registry`, error),
    ).then((record) => {
      state = { ...state, record };
      post();
    });
    void asRead(
      () => reads.describe(key, row.version),
      (error) => report(`describing ${key} ${row.version}`, error),
    ).then((describe) => {
      state = { ...state, describe };
      post();
    });
    return panel;
  }

  return {
    show(row) {
      const key = moduleKey(row);
      const existing = open.get(key);
      if (existing) {
        existing.reveal();
        return;
      }
      open.set(key, create(row));
    },
    dispose() {
      for (const panel of [...open.values()]) panel.dispose();
    },
  };
}
