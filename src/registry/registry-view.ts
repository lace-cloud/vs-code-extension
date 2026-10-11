// The registry sidebar, `laceRegistry`: a webview view in its kept design,
// drawn by the registry-sidebar page from the state this host sends. The
// host reads the module axis of the registry once, unfiltered, and the
// page narrows it as the developer searches and picks categories; a row's
// versions are read when it is expanded. The view reads again each time it
// becomes visible, since a terminal or another window can sign in or out
// or select another organization, and at each change of account this
// window makes, from whichever surface made it.
//
// Signed out and no organization are the states the list's failure names
// by its reason; any other failure shows its message with Retry. The
// organization shown is the CLI's selection, and its picker runs Select
// Organization. Favourites and recently used are drawn as they change,
// whichever surface placed the module.
import type { CommandFailure } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { type Account, SELECT_ORGANIZATION, SIGN_IN } from '../account/account';
import type { CommandOutcome } from '../engine/command-outcome';
import {
  moduleKey,
  type RegistryRow,
  type SidebarState,
  sidebarMessageOf,
  type ToPage,
} from '../protocol/registry-protocol';
import { pageHtml } from '../vscode/webview-html';
import type { RegistryMarks } from './registry-marks';
import { asRead, type RegistryReads } from './registry-reads';

export const REGISTRY_VIEW = 'laceRegistry';
export const REFRESH_REGISTRY = 'lace.refreshRegistry';

export type RegistryViewApi = {
  env: Pick<typeof vscode.env, 'openExternal'>;
  commands: Pick<typeof vscode.commands, 'executeCommand'>;
  Uri: Pick<typeof vscode.Uri, 'parse'>;
};

export type RegistryViewOptions = {
  api: RegistryViewApi;
  extensionUri: vscode.Uri;
  reads: RegistryReads;
  marks: RegistryMarks;
  account: Pick<Account, 'onDidChange'>;
  place: (module: { author: string; name: string; version: string }) => Promise<void>;
  showDetail: (row: RegistryRow) => void;
  report: (what: string, error: unknown) => void;
};

export type RegistryView = vscode.WebviewViewProvider & {
  refresh: () => Promise<void>;
  dispose: () => void;
};

type Unlisted = Exclude<SidebarState, { kind: 'loaded' }>;

// The sidebar state a failed list names by its reason.
export function failedListState(failure: CommandFailure): Unlisted {
  if (failure.reason === 'unauthenticated') return { kind: 'signedOut' };
  if (failure.reason === 'no_organization') return { kind: 'noOrganization' };
  return { kind: 'failed', message: failure.message };
}

type Listing = {
  rows: readonly RegistryRow[];
  truncated: boolean;
  organization: string | null;
  publishingGuideUrl: string;
  versions: Extract<SidebarState, { kind: 'loaded' }>['versions'];
};

const organizationOf = (outcome: CommandOutcome<'org current'>): string | null =>
  outcome.kind === 'result' ? outcome.document.slug : null;

export function createRegistryView(options: RegistryViewOptions): RegistryView {
  const { api, reads, marks, place, showDetail, report } = options;
  let view: vscode.WebviewView | undefined;
  // What the list said last: the rows and what came with them, or the
  // state a read that gave no rows leaves.
  let shown: Listing | Unlisted = { kind: 'loading' };
  // Each read's turn: a read applies only while no later one started.
  let reading = 0;

  function state(): SidebarState {
    if ('kind' in shown) return shown;
    const { rows, truncated, organization, versions } = shown;
    return {
      kind: 'loaded',
      rows,
      truncated,
      organization,
      versions,
      favourites: marks.favourites(),
      recents: marks.recents(),
    };
  }

  function post(): void {
    void view?.webview.postMessage({ op: 'state', state: state() } satisfies ToPage<SidebarState>);
  }

  async function refresh(): Promise<void> {
    const turn = ++reading;
    shown = { kind: 'loading' };
    post();
    let next: Listing | Unlisted;
    try {
      const [list, organization] = await Promise.all([reads.list(), reads.organization()]);
      if (list.kind === 'failure') next = failedListState(list.failure);
      else {
        next = {
          rows: list.document.items,
          truncated: list.document.truncated,
          organization: organizationOf(organization),
          publishingGuideUrl: list.document.publishingGuideUrl,
          versions: {},
        };
      }
    } catch (error) {
      report('reading the Lace registry', error);
      next = { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
    if (turn !== reading) return;
    shown = next;
    post();
  }

  const rowOf = (key: string): RegistryRow | undefined =>
    'kind' in shown ? undefined : shown.rows.find((row) => moduleKey(row) === key);

  async function readVersions(key: string): Promise<void> {
    const listing = shown;
    if ('kind' in listing) return;
    const set = (read: Listing['versions'][string]) => {
      listing.versions = { ...listing.versions, [key]: read };
      if (shown === listing) post();
    };
    set({ kind: 'loading' });
    const record = await asRead(
      () => reads.get(key),
      (error) => report(`reading the versions of ${key}`, error),
    );
    set(record.kind === 'loaded' ? { kind: 'loaded', value: record.value.versions } : record);
  }

  async function receive(raw: unknown): Promise<void> {
    const message = sidebarMessageOf(raw);
    if (!message) return;
    switch (message.op) {
      case 'ready':
        post();
        return;
      case 'refresh':
        return refresh();
      case 'signIn':
        await api.commands.executeCommand(SIGN_IN);
        return;
      case 'selectOrganization':
        await api.commands.executeCommand(SELECT_ORGANIZATION);
        return;
      case 'openPublishingGuide':
        if (!('kind' in shown)) await api.env.openExternal(api.Uri.parse(shown.publishingGuideUrl));
        return;
      case 'toggleFavourite':
        return marks.toggleFavourite(message.key);
      case 'versions':
        return readVersions(message.key);
      case 'showDetail': {
        const row = rowOf(message.key);
        if (row) showDetail(row);
        return;
      }
      case 'place': {
        const row = rowOf(message.key);
        if (row) await place({ author: row.author, name: row.name, version: message.version });
        return;
      }
    }
  }

  const offMarks = marks.onChanged(post);
  const offAccount = options.account.onDidChange(() => void refresh());

  return {
    refresh,
    dispose() {
      offMarks();
      offAccount();
    },
    resolveWebviewView(webviewView) {
      view = webviewView;
      const out = options.extensionUri.with({ path: `${options.extensionUri.path}/out` });
      webviewView.webview.options = { enableScripts: true, localResourceRoots: [out] };
      webviewView.webview.onDidReceiveMessage((raw) =>
        receive(raw).catch((error) => report('a message from the registry sidebar', error)),
      );
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) void refresh();
      });
      webviewView.onDidDispose(() => {
        if (view === webviewView) view = undefined;
      });
      webviewView.webview.html = pageHtml(
        {
          outUri: (file) =>
            webviewView.webview.asWebviewUri(out.with({ path: `${out.path}/${file}` })),
          cspSource: webviewView.webview.cspSource,
          title: 'Lace Registry',
        },
        { bundle: 'registry-sidebar', images: ['https:', 'data:'] },
      );
      void refresh();
    },
  };
}
