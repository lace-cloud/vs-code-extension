// The registry sidebar, `laceRegistry`: a webview view in its kept design,
// drawn by the registry-sidebar page from the state this host sends. The
// host reads the module axis of the registry once, unfiltered, and the
// page narrows it as the developer searches and picks categories; a row's
// versions are read when it is expanded. The view reads again at each change
// of the account: one this window makes, from whichever surface made it, and
// one a terminal or another window made, which the account finds when it
// reads itself again (`account.ts`). First shown, shown again, Refresh and
// Retry show loading at once and have the account read itself first.
//
// Signed out, the CLI lists the public catalog, drawn with no organization.
// A session the server refuses and no organization are the states the
// list's failure names by its reason; any other failure shows its message
// with Retry. The
// organization shown is the CLI's selection, and its picker runs Select
// Organization. Favourites and recently used are drawn as they change,
// whichever surface placed the module.
import type { CommandFailure } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { type Account, SELECT_ORGANIZATION, SIGN_IN } from '../account/account';
import { type CommandOutcome, failureText } from '../engine/command-outcome';
import {
  loaded,
  moduleKey,
  placement,
  type Read,
  type RegistryRecord,
  type RegistryRow,
  type RegistryVersion,
  type SidebarState,
  sidebarMessageOf,
  type ToPage,
} from '../protocol/registry-protocol';
import { pageHtml } from '../vscode/webview-html';
import type { Place } from './place-module';
import type { RegistryMarks } from './registry-marks';
import { asRead, type RegistryReads, reportFailure } from './registry-reads';

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
  account: Pick<Account, 'onDidChange' | 'refreshWith'>;
  place: Place;
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
  // The record each expanded module's read found: the sidebar draws its
  // versions, and a placement is given its latest.
  records: Readonly<Record<string, Read<RegistryRecord>>>;
};

const versionsOf = (read: Read<RegistryRecord>): Read<readonly RegistryVersion[]> =>
  read.kind === 'loaded' ? { kind: 'loaded', value: read.value.versions } : read;

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
    const { rows, truncated, organization, records } = shown;
    return {
      kind: 'loaded',
      rows,
      truncated,
      organization,
      versions: Object.fromEntries(
        Object.entries(records).map(([key, read]) => [key, versionsOf(read)]),
      ),
      favourites: marks.favourites(),
      recents: marks.recents(),
    };
  }

  function post(): void {
    void view?.webview.postMessage({ op: 'state', state: state() } satisfies ToPage<SidebarState>);
  }

  function showLoading(): void {
    if ('kind' in shown && shown.kind === 'loading') return;
    shown = { kind: 'loading' };
    post();
  }

  async function refresh(): Promise<void> {
    const turn = ++reading;
    showLoading();
    const toReport = (error: unknown) => report('reading the Lace registry', error);
    let next: Listing | Unlisted;
    try {
      const [list, organization] = await Promise.all([reads.list(), reads.organization()]);
      reportFailure(list, toReport);
      if (list.kind === 'failure') next = failedListState(list.failure);
      else {
        next = {
          rows: list.document.items,
          truncated: list.document.truncated,
          organization: organizationOf(reportFailure(organization, toReport)),
          publishingGuideUrl: list.document.publishingGuideUrl,
          records: {},
        };
      }
    } catch (error) {
      toReport(error);
      next = { kind: 'failed', message: failureText(error) };
    }
    if (turn !== reading) return;
    shown = next;
    post();
  }

  const reload = (): Promise<void> => {
    showLoading();
    return options.account.refreshWith(refresh);
  };

  const listing = (): Listing | undefined => ('kind' in shown ? undefined : shown);
  const rowOf = (key: string): RegistryRow | undefined =>
    listing()?.rows.find((row) => moduleKey(row) === key);

  async function readVersions(key: string): Promise<void> {
    const current = listing();
    if (!current) return;
    const set = (read: Read<RegistryRecord>) => {
      current.records = { ...current.records, [key]: read };
      if (shown === current) post();
    };
    set({ kind: 'loading' });
    set(
      await asRead(
        () => reads.get(key),
        (error) => report(`reading the versions of ${key}`, error),
      ),
    );
  }

  async function receive(raw: unknown): Promise<void> {
    const message = sidebarMessageOf(raw);
    if (!message) return;
    switch (message.op) {
      case 'ready':
        post();
        return;
      case 'refresh':
        return reload();
      case 'signIn':
        await api.commands.executeCommand(SIGN_IN);
        return;
      case 'selectOrganization':
        await api.commands.executeCommand(SELECT_ORGANIZATION);
        return;
      case 'openPublishingGuide': {
        const current = listing();
        if (current) await api.env.openExternal(api.Uri.parse(current.publishingGuideUrl));
        return;
      }
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
        if (row) {
          await place(...placement(row, message.version, loaded(listing()?.records[message.key])));
        }
        return;
      }
    }
  }

  const offMarks = marks.onChanged(post);
  const offAccount = options.account.onDidChange(() => void refresh());

  return {
    refresh: reload,
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
        if (webviewView.visible) void reload();
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
      void reload();
    },
  };
}
