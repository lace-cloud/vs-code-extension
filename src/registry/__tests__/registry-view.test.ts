import type { LaceReason } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { outsideSignals, signedInAs } from '../../account/__tests__/fake-outside';
import { createAccount } from '../../account/account';
import { fakeCommands, HOME, refused, type Script } from '../../engine/__tests__/fake-commands';
import { settled } from '../../engine/__tests__/fake-engine';
import { described, GUIDE, list, record, row } from '../../protocol/__tests__/registry-fixtures';
import type { SidebarState } from '../../protocol/registry-protocol';
import { uri } from '../../roots/__tests__/fake-uri';
import { type RegistryMarks, registryMarks } from '../registry-marks';
import { LIST_LIMIT, registryReads } from '../registry-reads';
import { createRegistryView, failedListState } from '../registry-view';

function memento(): vscode.Memento {
  const values = new Map<string, unknown>();
  return {
    keys: () => [...values.keys()],
    get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  } as vscode.Memento;
}

// A webview view whose posted states and visibility the test reads and
// drives.
function fakeWebviewView() {
  const posted: SidebarState[] = [];
  let receive: (message: unknown) => Promise<void> = async () => {};
  let visibility = () => {};
  const view = {
    visible: true,
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview://csp',
      asWebviewUri: (u: vscode.Uri) => u,
      postMessage: async (message: { state: SidebarState }) => {
        posted.push(message.state);
        return true;
      },
      onDidReceiveMessage: (listener: (m: unknown) => Promise<void>) => {
        receive = listener;
        return { dispose: () => {} };
      },
    },
    onDidChangeVisibility: (listener: () => void) => {
      visibility = listener;
      return { dispose: () => {} };
    },
    onDidDispose: () => ({ dispose: () => {} }),
  };
  return {
    view: view as unknown as vscode.WebviewView,
    posted,
    last: () => posted[posted.length - 1],
    send: (message: unknown) => receive(message),
    show: (visible: boolean) => {
      view.visible = visible;
      visibility();
    },
  };
}

const extensionUri = uri('/ext');

// A registry view over scripted commands. Its account is a stand-in the
// test changes, or, given what tells the window the account may have
// changed outside it, the window's account over the same commands.
function setup(
  answers: Record<string, Script | (() => Script | Promise<Script>)>,
  marks?: RegistryMarks,
  outside?: ReturnType<typeof outsideSignals>,
) {
  const { commands, invoked } = fakeCommands({
    'org current': { documents: [{ slug: 'acme-org', source: 'config' }] },
    ...answers,
  });
  const api = {
    env: { openExternal: vi.fn(async () => true) },
    commands: { executeCommand: vi.fn(async () => undefined) },
    Uri: { parse: (value: string) => ({ parsed: value }) },
  };
  const place = vi.fn(async () => {});
  const showDetail = vi.fn();
  const reports: unknown[] = [];
  const changes = new Set<() => void>();
  const account = {
    onDidChange: (listener: () => void) => {
      changes.add(listener);
      return () => changes.delete(listener);
    },
    // The window's account changed: a sign-in, a sign-out or a pick.
    change: () => {
      for (const listener of [...changes]) listener();
    },
  };
  const registry = createRegistryView({
    api: api as never,
    extensionUri,
    reads: registryReads(commands),
    marks: marks ?? registryMarks(memento()),
    account: outside
      ? createAccount(commands, { window: outside.window } as never, (_what, error) =>
          reports.push(error),
        )
      : account,
    place,
    showDetail,
    report: (_what, error) => reports.push(error),
  });
  const page = fakeWebviewView();
  registry.resolveWebviewView(page.view, {} as never, {} as never);
  return { registry, page, invoked, api, place, showDetail, reports, account };
}

const VPC = row();
const DB = row({ id: 'man_9', name: 'db', displayName: 'ACME DB', categories: ['data'] });

describe('the registry reads', () => {
  test('list the module axis, up to the most one list returns, from the developer’s home', async () => {
    const { invoked } = setup({ 'registry list': { documents: [list([VPC])] } });
    await settled();
    expect(invoked).toContainEqual({
      cwd: HOME,
      path: 'registry list',
      args: { axis: 'module', limit: LIST_LIMIT },
    });
  });

  test('name a module and a version as the registry commands take them', async () => {
    const { commands, invoked } = fakeCommands({
      'registry get': { documents: [record()] },
      'registry describe': { documents: [described] },
    });
    const reads = registryReads(commands);
    await reads.get('acme/vpc');
    await reads.describe('acme/vpc', '1.0.0');
    expect(invoked.map(({ path, args }) => ({ path, args }))).toEqual([
      { path: 'registry get', args: { artifact: 'module/acme/vpc' } },
      { path: 'registry describe', args: { artifact: 'module/acme/vpc', version: '1.0.0' } },
    ]);
  });
});

describe('the registry sidebar', () => {
  test("draws the list's rows as the CLI gives them, with the CLI's organization", async () => {
    const { page } = setup({ 'registry list': { documents: [list([VPC, DB], true)] } });
    await settled();
    expect(page.last()).toEqual({
      kind: 'loaded',
      rows: [VPC, DB],
      truncated: true,
      organization: 'acme-org',
      favourites: [],
      recents: [],
      versions: {},
    });
  });

  test.each<[LaceReason, SidebarState]>([
    ['unauthenticated', { kind: 'signedOut' }],
    ['no_organization', { kind: 'noOrganization' }],
  ])('a list refused with %s is that state', async (reason, state) => {
    const { page } = setup({
      'registry list': refused({ reason, message: 'whatever the CLI says' }),
    });
    await settled();
    expect(page.last()).toEqual(state);
  });

  test('a failure is named by its reason, never by its text', () => {
    expect(
      failedListState({
        reason: 'unspecified',
        message: "no credentials found; please run 'lace login'",
      }),
    ).toEqual({ kind: 'failed', message: "no credentials found; please run 'lace login'" });
  });

  test("an empty registry's guide link is the URL the list carries", async () => {
    const { page, api } = setup({ 'registry list': { documents: [list([])] } });
    await settled();
    expect(page.last()).toMatchObject({ kind: 'loaded', rows: [] });

    await page.send({ op: 'openPublishingGuide', url: 'https://elsewhere' });
    expect(api.env.openExternal).toHaveBeenCalledWith({ parsed: GUIDE });
  });

  test('reads again when it becomes visible, and on refresh', async () => {
    const { page, invoked, registry } = setup({ 'registry list': { documents: [list([VPC])] } });
    await settled();
    page.show(false);
    page.show(true);
    await registry.refresh();
    await settled();
    expect(invoked.filter((run) => run.path === 'registry list')).toHaveLength(3);
  });

  test('a later read wins over an earlier one that settles after it', async () => {
    let first = (_: Script) => {};
    let reads = 0;
    const { page, registry } = setup({
      'registry list': () => {
        reads += 1;
        if (reads === 1) return new Promise<Script>((resolve) => (first = resolve));
        return Promise.resolve({ documents: [list([DB])] });
      },
    });
    await registry.refresh();
    first({ documents: [list([VPC])] });
    await settled();
    expect(page.last()).toMatchObject({ rows: [DB] });
  });

  test("reads a row's versions when it is expanded", async () => {
    const { page, invoked } = setup({
      'registry list': { documents: [list([VPC])] },
      'registry get': { documents: [record({ versions: ['2.0.0', '1.0.0'] })] },
    });
    await settled();
    await page.send({ op: 'versions', key: 'acme/vpc' });
    expect(invoked).toContainEqual({
      cwd: HOME,
      path: 'registry get',
      args: { artifact: 'module/acme/vpc' },
    });
    expect(page.last()).toMatchObject({
      versions: {
        'acme/vpc': { kind: 'loaded', value: [{ version: '2.0.0' }, { version: '1.0.0' }] },
      },
    });
  });

  test('places the row the page names, at the version it names, and nothing for an unknown key', async () => {
    const { page, place } = setup({ 'registry list': { documents: [list([VPC])] } });
    await settled();
    await page.send({ op: 'place', key: 'acme/vpc', version: '1.0.0' });
    await page.send({ op: 'place', key: 'evil/thing', version: '1.0.0' });
    expect(place.mock.calls).toEqual([[{ author: 'acme', name: 'vpc', version: '1.0.0' }]]);
  });

  test('a favourite is keyed on author and name, so a new latest version keeps it', async () => {
    const marks = registryMarks(memento());
    const { page } = setup({ 'registry list': { documents: [list([VPC])] } }, marks);
    await settled();
    await page.send({ op: 'toggleFavourite', key: 'acme/vpc' });
    expect(page.last()).toMatchObject({ favourites: ['acme/vpc'] });

    const next = setup(
      { 'registry list': { documents: [list([row({ id: 'man_3', version: '3.0.0' })])] } },
      marks,
    );
    await settled();
    expect(next.page.last()).toMatchObject({ favourites: ['acme/vpc'] });
  });

  test('draws recently used as a placement anywhere records it', async () => {
    const marks = registryMarks(memento());
    const { page } = setup({ 'registry list': { documents: [list([VPC, DB])] } }, marks);
    await settled();
    await marks.placed('acme/db');
    await marks.placed('acme/vpc');
    expect(page.last()).toMatchObject({ recents: ['acme/vpc', 'acme/db'] });
  });

  test('opens module detail for the row the page names', async () => {
    const { page, showDetail } = setup({ 'registry list': { documents: [list([VPC])] } });
    await settled();
    await page.send({ op: 'showDetail', key: 'acme/vpc' });
    expect(showDetail).toHaveBeenCalledWith(VPC);
  });

  test.each([
    ['signIn', 'lace.signIn'],
    ['selectOrganization', 'lace.selectOrganization'],
  ])('%s runs %s, the account command every surface runs', async (op, command) => {
    const { page, api } = setup({ 'registry list': { documents: [list([])] } });
    await settled();
    await page.send({ op });
    expect(api.commands.executeCommand).toHaveBeenCalledWith(command);
  });

  test('reads again at each change of account, from whichever surface made it, until disposed', async () => {
    const { registry, invoked, account } = setup({ 'registry list': { documents: [list([])] } });
    await settled();
    account.change();
    await settled();
    expect(invoked.filter((run) => run.path === 'registry list')).toHaveLength(2);

    registry.dispose();
    account.change();
    await settled();
    expect(invoked.filter((run) => run.path === 'registry list')).toHaveLength(2);
  });

  test('reads again when a lace command in the terminal changed the account, and not when it left it as it was', async () => {
    let signedIn = true;
    const outside = outsideSignals();
    const { page, invoked } = setup(
      {
        'registry list': () =>
          signedIn
            ? { documents: [list([VPC])] }
            : refused({ reason: 'unauthenticated', message: 'no credentials found' }),
        whoami: () =>
          signedIn
            ? { documents: [signedInAs('usr_1')] }
            : refused({ reason: 'unauthenticated', message: 'no credentials found' }),
        'team current': { documents: [{ slug: null, source: null }] },
      },
      undefined,
      outside,
    );
    const lists = () => invoked.filter((run) => run.path === 'registry list').length;
    await settled();
    expect(page.last()).toMatchObject({ kind: 'loaded', rows: [VPC] });

    outside.ended('lace org current');
    outside.focus();
    await settled();
    expect(lists()).toBe(1);

    signedIn = false;
    outside.ended('lace logout');
    await settled();
    await settled();
    expect(lists()).toBe(2);
    expect(page.last()).toEqual({ kind: 'signedOut' });
  });

  test('serves its page under a CSP that loads https images and runs only its own script', () => {
    const { page } = setup({ 'registry list': { documents: [list([])] } });
    const html = page.view.webview.html;
    expect(html).toMatch(/img-src [^;]*https:/);
    expect(html).toMatch(/script-src 'nonce-[0-9a-f]+'/);
    expect(html).toContain('registry-sidebar.js');
  });
});
