import type { LaceReason } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
  outsideSignals,
  refreshWithNoChange,
  signedInAs,
} from '../../account/__tests__/fake-outside';
import { statusBarOver } from '../../account/__tests__/fake-status-bar';
import { createAccount } from '../../account/account';
import {
  failsWith,
  fakeCommands,
  HOME,
  refused,
  type Script,
  timesRun,
} from '../../engine/__tests__/fake-commands';
import { settled } from '../../engine/__tests__/fake-engine';
import { described, GUIDE, list, record, row } from '../../protocol/__tests__/registry-fixtures';
import type { SidebarState } from '../../protocol/registry-protocol';
import { uri } from '../../roots/__tests__/fake-uri';
import type { Place } from '../place-module';
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
  const { commands, invoked, held } = fakeCommands({
    'org current': { documents: [{ slug: 'acme-org', source: 'config' }] },
    ...answers,
  });
  const api = {
    env: { openExternal: vi.fn(async () => true) },
    commands: { executeCommand: vi.fn(async () => undefined) },
    Uri: { parse: (value: string) => ({ parsed: value }) },
  };
  const place = vi.fn<Place>(async () => {});
  const showDetail = vi.fn();
  const reports: unknown[] = [];
  const changes = new Set<() => void>();
  const account = {
    onDidChange: (listener: () => void) => {
      changes.add(listener);
      return () => changes.delete(listener);
    },
    refreshWith: refreshWithNoChange(),
    // The window's account changed: a sign-in, a sign-out or a pick.
    change: () => {
      for (const listener of [...changes]) listener();
    },
  };
  const windowAccount = outside
    ? createAccount(commands, { window: outside.window } as never, (_what, error) =>
        reports.push(error),
      )
    : undefined;
  const registry = createRegistryView({
    api: api as never,
    extensionUri,
    reads: registryReads(commands),
    marks: marks ?? registryMarks(memento()),
    account: windowAccount ?? account,
    place,
    showDetail,
    report: (_what, error) => reports.push(error),
  });
  const page = fakeWebviewView();
  registry.resolveWebviewView(page.view, {} as never, {} as never);
  return {
    registry,
    page,
    invoked,
    api,
    place,
    showDetail,
    reports,
    account,
    windowAccount,
    commands,
    held,
  };
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
    expect(timesRun(invoked, 'registry list')).toBe(3);
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
    expect(place.mock.calls).toEqual([[{ author: 'acme', name: 'vpc', version: '1.0.0' }, '']]);
  });

  test("names a placed version as deprecated by the status the host's own reads give it: the row's, or its versions' read", async () => {
    const { page, place } = setup({
      'registry list': { documents: [list([row({ status: 'deprecated' })])] },
      'registry get': {
        documents: [
          record({ versions: ['v2.0.0', 'v1.5.0', 'v1.0.0'], deprecated: ['v2.0.0', 'v1.0.0'] }),
        ],
      },
    });
    await settled();
    const placeAt = (version: string) =>
      page.send({ op: 'place', key: 'acme/vpc', version, status: 'published' });
    await placeAt('v1.0.0');
    await page.send({ op: 'versions', key: 'acme/vpc' });
    await settled();
    for (const version of ['v2.0.0', 'v1.5.0', 'v1.0.0']) await placeAt(version);
    expect(place.mock.calls.map(([module, status]) => [module.version, status])).toEqual([
      ['v1.0.0', ''],
      ['v2.0.0', 'deprecated'],
      ['v1.5.0', 'published'],
      ['v1.0.0', 'deprecated'],
    ]);
    expect(place.mock.calls.every(([module]) => !('status' in module))).toBe(true);
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
    expect(timesRun(invoked, 'registry list')).toBe(2);

    registry.dispose();
    account.change();
    await settled();
    expect(timesRun(invoked, 'registry list')).toBe(2);
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
    const lists = () => timesRun(invoked, 'registry list');
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

// A developer signed in whom a terminal outside the window changes
// (`lace org use`, `lace team use`), with no focus to tell the window.
describe('a read the developer or the view starts asks the account to read itself first', () => {
  function outsideSetup(failing: { organization?: boolean; whoami?: boolean } = {}) {
    const account = {
      organization: 'acme-org',
      team: 'platform',
      failing,
      // Whether `whoami` is held until the test finishes it.
      holding: false,
    };
    const outside = outsideSignals();
    const t = setup(
      {
        'registry list': { documents: [list([VPC])] },
        whoami: () => {
          if (account.holding) return { held: true };
          return account.failing.whoami
            ? failsWith('the engine stopped')
            : { documents: [signedInAs('usr_1')] };
        },
        'org current': () =>
          account.failing.organization
            ? failsWith('the engine was not up')
            : { documents: [{ slug: account.organization, source: 'config' }] },
        'team current': () => ({ documents: [{ slug: account.team, source: 'config' }] }),
      },
      undefined,
      outside,
    );
    const { windowAccount, page } = t;
    if (!windowAccount) throw new Error('the window account');
    // What the Stacks tree and the canvas's status bar subscribe to.
    const stacks = vi.fn();
    windowAccount.onDidChange(stacks);
    const bar = statusBarOver(windowAccount, t.commands);
    // What the page was sent since `from`, by kind.
    const sentSince = (from: number) => page.posted.slice(from).map((state) => state.kind);
    return { ...t, account, outside, stacks, bar, sentSince, windowAccount };
  }

  test('Refresh after an organization switched outside: the status bar, the Stacks view and the Registry agree, each redrawn once', async () => {
    const t = outsideSetup();
    await settled();
    expect(t.bar.status.text).toBe('$(organization) acme-org · platform');
    expect(t.page.last()).toMatchObject({ kind: 'loaded', organization: 'acme-org' });
    const sent = t.page.posted.length;
    const lists = timesRun(t.invoked, 'registry list');

    t.account.organization = 'globex-org';
    t.account.team = 'data';
    await t.registry.refresh();
    await settled();

    expect(t.bar.status.text).toBe('$(organization) globex-org · data');
    expect(t.stacks).toHaveBeenCalledTimes(1);
    expect(t.page.last()).toMatchObject({ kind: 'loaded', organization: 'globex-org' });
    expect(timesRun(t.invoked, 'registry list')).toBe(lists + 1);
    expect(t.sentSince(sent)).toEqual(['loading', 'loaded']);
  });

  test('Refresh shows loading at once, while the account is still being read', async () => {
    const t = outsideSetup();
    await settled();
    t.account.holding = true;

    const refreshing = t.registry.refresh();
    expect(t.page.last()).toEqual({ kind: 'loading' });
    await settled();
    t.account.holding = false;
    t.held[0].finish([signedInAs('usr_1')]);
    await refreshing;
    await settled();
    expect(t.page.last()).toMatchObject({ kind: 'loaded' });
  });

  test('Refresh after a team switched outside changes the status bar and the Stacks view', async () => {
    const t = outsideSetup();
    await settled();
    t.account.team = 'data';
    await t.registry.refresh();
    await settled();
    expect(t.bar.status.text).toBe('$(organization) acme-org · data');
    expect(t.stacks).toHaveBeenCalledTimes(1);
  });

  test('Refresh with the account as it was reads the registry once and announces nothing', async () => {
    const t = outsideSetup();
    await settled();
    const sent = t.page.posted.length;
    const lists = timesRun(t.invoked, 'registry list');
    const reads = timesRun(t.invoked, 'whoami');

    await t.registry.refresh();
    await settled();

    expect(t.stacks).not.toHaveBeenCalled();
    expect(timesRun(t.invoked, 'registry list')).toBe(lists + 1);
    expect(timesRun(t.invoked, 'whoami')).toBe(reads + 1);
    expect(t.sentSince(sent)).toEqual(['loading', 'loaded']);
  });

  test('Refresh when the account cannot be read lists the registry, reports the failure and resolves', async () => {
    const t = outsideSetup();
    await settled();
    t.account.failing.whoami = true;
    t.reports.length = 0;

    await expect(t.registry.refresh()).resolves.toBeUndefined();
    await settled();

    expect(t.page.last()).toMatchObject({ kind: 'loaded', rows: [VPC] });
    expect(t.reports).toEqual([expect.objectContaining({ message: 'the engine stopped' })]);
    expect(t.stacks).not.toHaveBeenCalled();
  });

  test('Refresh after a start that could not read the account announces the account it now finds', async () => {
    const t = outsideSetup({ organization: true });
    await settled();
    expect(t.bar.status.visible).toBe(false);
    expect(t.page.last()).toMatchObject({ kind: 'failed' });

    t.account.failing.organization = false;
    await t.registry.refresh();
    await settled();

    expect(t.bar.status.text).toBe('$(organization) acme-org · platform');
    expect(t.bar.status.visible).toBe(true);
    expect(t.page.last()).toMatchObject({ kind: 'loaded', organization: 'acme-org' });
  });

  test('Refresh while a focus read is under way announces once, and the older read settling after it changes nothing', async () => {
    const t = outsideSetup();
    await settled();
    t.account.holding = true;
    t.outside.focus();
    await settled();

    t.account.holding = false;
    t.account.organization = 'globex-org';
    await t.registry.refresh();
    t.held[0].finish([signedInAs('usr_1')]);
    await settled();

    expect(t.stacks).toHaveBeenCalledTimes(1);
    expect(t.page.last()).toMatchObject({ kind: 'loaded', organization: 'globex-org' });
    t.outside.focus();
    await settled();
    expect(t.stacks).toHaveBeenCalledTimes(1);
  });

  test('the focus after a Refresh that found a change announces nothing more', async () => {
    const t = outsideSetup();
    await settled();
    t.account.organization = 'globex-org';
    await t.registry.refresh();
    await settled();
    const lists = timesRun(t.invoked, 'registry list');

    t.outside.focus();
    await settled();

    expect(t.stacks).toHaveBeenCalledTimes(1);
    expect(timesRun(t.invoked, 'registry list')).toBe(lists);
  });

  test('Retry, and the view shown again, read the account too', async () => {
    const t = outsideSetup();
    await settled();
    t.account.organization = 'globex-org';
    await t.page.send({ op: 'refresh' });
    await settled();
    expect(t.stacks).toHaveBeenCalledTimes(1);
    expect(t.bar.status.text).toBe('$(organization) globex-org · platform');

    t.account.team = 'data';
    t.page.show(false);
    t.page.show(true);
    await settled();
    expect(t.stacks).toHaveBeenCalledTimes(2);
    expect(t.bar.status.text).toBe('$(organization) globex-org · data');
  });

  test('the first load reads the account, which has already read itself once at start', async () => {
    const t = outsideSetup();
    await settled();
    expect(timesRun(t.invoked, 'whoami')).toBe(2);
  });

  test('an announced change is read by the view as the plain refresh: no further read of the account', async () => {
    const t = outsideSetup();
    await settled();
    const reads = timesRun(t.invoked, 'whoami');
    t.account.organization = 'globex-org';
    await t.registry.refresh();
    await settled();
    expect(timesRun(t.invoked, 'whoami')).toBe(reads + 1);
  });

  test('its own listener of the account refreshes the registry, and does not have the account read itself', async () => {
    const { account, invoked } = setup({ 'registry list': { documents: [list([VPC])] } });
    await settled();
    const lists = timesRun(invoked, 'registry list');
    account.refreshWith.mockClear();

    account.change();
    await settled();

    expect(account.refreshWith).not.toHaveBeenCalled();
    expect(timesRun(invoked, 'registry list')).toBe(lists + 1);
  });
});
