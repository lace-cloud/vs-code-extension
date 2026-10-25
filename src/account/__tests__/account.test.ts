import { CommandExitError, CommandUnobservedError } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import {
  fakeCommands,
  type Invoked,
  refused,
  type Script,
} from '../../engine/__tests__/fake-commands';
import { type Button, clicked, shownBy } from '../../vscode/__tests__/fake-messages';
import { fakeQuickPicks } from '../../vscode/__tests__/fake-quick-pick';
import { type Account, accountControls, createAccount, SELECT_ORGANIZATION } from '../account';
import { selectionStatus } from '../scope';
import { outsideSignals, signedInAs } from './fake-outside';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const ORGS = {
  items: [
    { slug: 'acme', name: 'Acme', role: 'owner' },
    { slug: 'globex', name: 'Globex', role: 'member' },
  ],
};
const team = (slug: string) => ({
  id: `team_${slug}`,
  orgId: 'org_1',
  name: slug[0].toUpperCase() + slug.slice(1),
  slug,
  description: '',
  createdBy: 'usr_1',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  role: 'member',
  memberCount: 1,
});
const TEAM_CREATE_URL = 'https://portal/o/globex/teams/new';
const teams = (...slugs: string[]) => ({
  items: slugs.map(team),
  nextCursor: null,
  hasMore: false,
  createUrl: TEAM_CREATE_URL,
});
type Current = { slug: string; source: 'config' | 'env' } | { slug: null; source: null };
const current = (slug: string | null, source: 'config' | 'env' = 'config'): Current =>
  slug === null ? { slug: null, source: null } : { slug, source };

const SIGNED_OUT = refused({ reason: 'unauthenticated', message: 'no credentials found' });

// What a command of the account ran: the invocations it made, up to the
// account's own read that follows a change, which begins with `whoami`.
const ranBy = (invoked: readonly Invoked[]): Invoked[] => {
  const read = invoked.findIndex((call) => call.path === 'whoami');
  return read === -1 ? [...invoked] : invoked.slice(0, read);
};

// An account over scripted commands, once its first read of the account
// has settled; `since()` is what was invoked after that.
async function setup(
  scripts: Parameters<typeof fakeCommands>[0],
  picks: (string | undefined)[] = [],
) {
  const commands = fakeCommands(scripts);
  const outside = outsideSignals();
  // Each pick answers with the item of the next slug in `picks`; none dismisses it.
  const quickPicks = fakeQuickPicks<{ label: string; description?: string; slug: string }>(
    (items) => {
      const slug = picks.shift();
      return items.find((item) => item.slug === slug);
    },
  );
  const api = {
    window: {
      ...outside.window,
      withProgress: vi.fn(async (_options, task) =>
        task({ report: vi.fn() }, { onCancellationRequested: () => ({ dispose: () => {} }) }),
      ),
      showInformationMessage: vi.fn(
        async (_text: string, ..._actions: string[]): Promise<string | undefined> => undefined,
      ),
      showWarningMessage: vi.fn(
        async (_text: string, ..._actions: string[]): Promise<string | undefined> => undefined,
      ),
      showErrorMessage: vi.fn(async () => undefined),
      createQuickPick: quickPicks.createQuickPick,
    },
    env: { openExternal: vi.fn(async () => true), clipboard: { writeText: vi.fn(async () => {}) } },
    Uri: { parse: (url: string) => ({ url }) },
    ProgressLocation: { Notification: 15 },
  };
  const report = vi.fn();
  const account = createAccount(commands.commands, api as never, report);
  const changed = vi.fn();
  account.onDidChange(changed);
  await settled();
  const from = commands.invoked.length;
  const since = () => ranBy(commands.invoked.slice(from));
  return { commands, api, account, changed, picks: quickPicks.picks, outside, report, since };
}

describe('selecting the organization', () => {
  test('picks from org list, marks the current one, runs org use and goes on to the team', async () => {
    const { account, changed, picks, since } = await setup(
      {
        'org list': { documents: [ORGS] },
        'org current': { documents: [current('acme')] },
        'org use': { documents: [{ organization: 'globex', team: null }] },
        'team list': { documents: [teams('platform', 'data')] },
        'team current': { documents: [current(null)] },
        'team use': { documents: [{ organization: 'globex', team: 'data' }] },
      },
      ['globex', 'data'],
    );
    await account.selectOrganization();

    expect(picks[0].items.map((item) => [item.label, item.description])).toEqual([
      ['Acme', 'acme · current · owner'],
      ['Globex', 'globex · member'],
    ]);
    expect(picks[0].items.some((item) => 'detail' in item)).toBe(false);
    expect(picks[1].items.map((item) => [item.label, item.description])).toEqual([
      ['Platform', 'platform'],
      ['Data', 'data'],
    ]);
    expect(picks[0].placeholder).toBe('Select a Lace organization');
    expect(picks[1].placeholder).toBe('Select a Lace team');
    expect(
      since()
        .filter((c) => c.path.startsWith('team '))
        .map((c) => [c.path, c.args]),
    ).toEqual([
      ['team list', { org: 'globex' }],
      ['team current', { org: 'globex' }],
      ['team use', { team: 'data', org: 'globex' }],
    ]);
    expect(
      since()
        .filter((c) => c.path.endsWith(' use'))
        .map((c) => c.path),
    ).toEqual(['org use', 'team use']);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('a row whose name is its slug names it once, with the current mark and the role on the same line', async () => {
    const { account, picks } = await setup(
      {
        'org list': {
          documents: [
            {
              items: [
                { slug: 'raji', name: 'raji', role: 'admin' },
                { slug: 'new-qxf2-qa', name: 'new-qxf2-qa', role: 'admin' },
              ],
            },
          ],
        },
        'org current': { documents: [current('raji')] },
        'org use': { documents: [{ organization: 'new-qxf2-qa', team: null }] },
        'team list': {
          documents: [
            {
              ...teams('new-delhi-qa'),
              items: [{ ...team('new-delhi-qa'), name: 'new-delhi-qa' }],
            },
          ],
        },
        'team current': { documents: [current('new-delhi-qa')] },
        'team use': { documents: [{ organization: 'new-qxf2-qa', team: 'new-delhi-qa' }] },
      },
      ['new-qxf2-qa', 'new-delhi-qa'],
    );
    await account.selectOrganization();

    expect(picks[0].items.map((item) => [item.label, item.description])).toEqual([
      ['raji', 'current · admin'],
      ['new-qxf2-qa', 'admin'],
    ]);
    expect(picks[1].items.map((item) => [item.label, item.description])).toEqual([
      ['new-delhi-qa', 'current'],
    ]);
  });

  test('the organization pick is on screen, busy, while the organizations are read', async () => {
    const { commands, account, picks } = await setup({
      'org list': { held: true },
      'org current': { documents: [current('acme')] },
    });
    const selecting = account.selectOrganization();
    await settled();
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({
      visible: true,
      shownBusy: true,
      busy: true,
      items: [],
      placeholder: 'Select a Lace organization',
    });

    commands.held[0].finish([ORGS]);
    await settled();
    expect(picks[0].busy).toBe(false);
    expect(picks[0].items.map((item) => item.label)).toEqual(['Acme', 'Globex']);
    picks[0].dismiss();
    await selecting;
  });

  test('the team pick is on screen, busy, while the organization is saved and its teams are read', async () => {
    const { commands, account, changed, picks, since } = await setup(
      {
        'org list': { documents: [ORGS] },
        'org current': { documents: [current('acme')] },
        'org use': { held: true },
        'team list': { documents: [teams('platform', 'data')] },
        'team current': { documents: [current(null)] },
        'team use': { documents: [{ organization: 'globex', team: 'data' }] },
      },
      ['globex', 'data'],
    );
    const selecting = account.selectOrganization();
    await settled();
    expect(picks).toHaveLength(2);
    expect(picks[1]).toMatchObject({
      visible: true,
      shownBusy: true,
      busy: true,
      items: [],
      placeholder: 'Select a Lace team',
    });
    expect(since().map((c) => c.path)).toEqual(['org list', 'org current', 'org use']);

    commands.held[0].finish([{ organization: 'globex', team: null }]);
    await selecting;
    expect(picks[1].items.map((item) => item.label)).toEqual(['Platform', 'Data']);
    expect(since().map((c) => c.path)).toEqual([
      'org list',
      'org current',
      'org use',
      'team list',
      'team current',
      'team use',
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('an organization saved while its team pick was dismissed is still announced', async () => {
    const { commands, account, changed, picks } = await setup(
      {
        'org list': { documents: [ORGS] },
        'org current': { documents: [current('acme')] },
        'org use': { held: true },
      },
      ['globex'],
    );
    const selecting = account.selectOrganization();
    await settled();
    picks[1].dismiss();
    commands.held[0].finish([{ organization: 'globex', team: null }]);
    await selecting;
    expect(commands.paths()).not.toContain('team use');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('an organization that cannot be saved closes the team pick and fails the command', async () => {
    const { commands, account, changed, picks } = await setup(
      {
        'org list': { documents: [ORGS] },
        'org current': { documents: [current('acme')] },
        'org use': refused({ reason: 'unauthenticated', message: 'no credentials' }),
      },
      ['globex'],
    );
    await expect(account.selectOrganization()).rejects.toThrow('no credentials');
    expect(picks[1]).toMatchObject({ visible: false, disposed: true });
    expect(commands.paths()).not.toContain('team list');
    expect(changed).not.toHaveBeenCalled();
  });

  test('with the organization set by the environment, the pick says so', async () => {
    const { account, picks } = await setup({
      'org list': { documents: [ORGS] },
      'org current': { documents: [current('acme', 'env')] },
    });
    await account.selectOrganization();
    expect(picks[0].placeholder).toBe(
      "The Lace engine's environment sets the organization; the choice made here is saved and applies once that variable is unset",
    );
  });

  test('dismissing the pick saves nothing and announces nothing', async () => {
    const { commands, account, changed } = await setup({
      'org list': { documents: [ORGS] },
      'org current': { documents: [current('acme')] },
    });
    await account.selectOrganization();
    expect(commands.paths()).not.toContain('org use');
    expect(changed).not.toHaveBeenCalled();
  });

  test('an account in no organization says so and leaves no pick open', async () => {
    const { api, account, changed, picks } = await setup({
      'org list': { documents: [{ items: [] }] },
      'org current': { documents: [current(null)] },
    });
    await account.selectOrganization();
    expect(picks[0]).toMatchObject({ visible: false, items: [] });
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'Your Lace account belongs to no organization yet. Organizations are created in the portal.',
    );
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('selecting the team', () => {
  test('lists and saves a team of the current organization, naming none', async () => {
    const { account, since } = await setup(
      {
        'team list': { documents: [teams('platform', 'data')] },
        'team current': { documents: [current('platform')] },
        'team use': { documents: [{ organization: 'acme', team: 'data' }] },
      },
      ['data'],
    );
    await account.selectTeam();
    expect(since().map((c) => [c.path, c.args])).toEqual([
      ['team list', {}],
      ['team current', {}],
      ['team use', { team: 'data' }],
    ]);
  });

  test('the team pick is on screen, busy, while the teams are read', async () => {
    const { commands, account, picks } = await setup({
      'team list': { held: true },
      'team current': { documents: [current('platform', 'env')] },
    });
    const selecting = account.selectTeam();
    await settled();
    expect(picks[0]).toMatchObject({ visible: true, shownBusy: true, busy: true, items: [] });

    commands.held[0].finish([teams('platform', 'data')]);
    await settled();
    expect(picks[0].placeholder).toBe(
      "The Lace engine's environment sets the team; the choice made here is saved and applies once that variable is unset",
    );
    picks[0].dismiss();
    await selecting;
  });

  test('an organization with no team says teams are made in the portal, and leaves no pick open', async () => {
    const { api, account, commands, changed, picks } = await setup({
      'team list': { documents: [teams()] },
      'team current': { documents: [current(null)] },
    });
    await account.selectTeam();
    expect(picks[0]).toMatchObject({ visible: false, items: [] });
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'This organization has no team yet. Teams are created in the portal.',
      'Open Portal',
    );
    await settled();
    expect(api.env.openExternal).not.toHaveBeenCalled();
    expect(commands.paths()).not.toContain('team use');
    expect(changed).not.toHaveBeenCalled();
  });

  test('Open Portal on an organization with no team opens the page team list names for making one', async () => {
    const { api, account } = await setup({
      'team list': { documents: [teams()] },
      'team current': { documents: [current(null)] },
    });
    api.window.showInformationMessage.mockResolvedValueOnce('Open Portal');
    await account.selectTeam();
    await settled();
    expect(api.env.openExternal).toHaveBeenCalledWith({ url: TEAM_CREATE_URL });
  });
});

describe('signing in', () => {
  test('shows the code once, opens the page once, and announces the change', async () => {
    const { api, account, changed, since } = await setup({
      login: {
        documents: [
          { type: 'code', code: 'ABCD-2345' },
          { type: 'url', url: 'https://lace.example.com/auth/cli?pollKey=pk_1' },
          { type: 'code', code: 'ABCD-2345' },
          { type: 'url', url: 'https://lace.example.com/auth/cli?pollKey=pk_1' },
          {
            type: 'result',
            user: { id: 'usr_1', email: 'dev@example.com', name: 'Dev' },
            replacedKey: { revocation: 'none' },
          },
        ],
      },
    });
    await account.signIn();

    expect(since().map((c) => [c.path, c.args])).toEqual([['login', {}]]);
    const codes = (api.window.showInformationMessage.mock.calls as unknown[][]).filter(([text]) =>
      String(text).includes('ABCD-2345'),
    );
    expect(codes).toEqual([
      [
        'Your Lace sign-in code is ABCD-2345. Type it on the page that opened in your browser.',
        'Copy Code',
      ],
    ]);
    expect(api.env.openExternal).toHaveBeenCalledTimes(1);
    expect(api.env.openExternal).toHaveBeenCalledWith({
      url: 'https://lace.example.com/auth/cli?pollKey=pk_1',
    });
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'Signed in to Lace as Dev (dev@example.com).',
    );
    expect(changed).toHaveBeenCalledTimes(1);
  });

  const signedInAs = (replacedKey: object) => ({
    login: {
      documents: [
        { type: 'code', code: 'ABCD-2345' },
        {
          type: 'result',
          user: { id: 'usr_1', email: 'dev@example.com', name: 'Dev' },
          replacedKey,
        },
      ],
    },
  });
  const SIGNED_IN =
    'Signed in to Lace as Dev (dev@example.com). The credentials this machine held before are replaced.';

  test('over credentials this machine held, says their key is revoked, offers nothing and announces the change', async () => {
    const { api, account, changed } = await setup(signedInAs({ revocation: 'revoked' }));
    await account.signIn();
    expect(shownBy(api.window.showInformationMessage)).toContainEqual([
      `${SIGNED_IN} Their API key is revoked.`,
    ]);
    expect(api.window.showWarningMessage).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('over credentials whose key Lace did not revoke, warns that the key may still be live, and Open Portal opens the page the result names', async () => {
    const PAGE = 'https://lace.example.com/account';
    const { api, account, changed } = await setup(
      signedInAs({
        revocation: 'refused',
        detail: 'the Lace server that issued this key does not accept it',
        portalUrl: PAGE,
      }),
    );
    let answer: (title: string) => void = () => {};
    api.window.showWarningMessage.mockImplementationOnce(
      () => new Promise<string | undefined>((resolve) => (answer = resolve)),
    );
    await account.signIn();
    expect(shownBy(api.window.showWarningMessage)).toEqual([
      [
        `${SIGNED_IN} Lace did not revoke their API key: the Lace server that issued this key does not accept it. The key may still be live. Revoke it in the portal under Account, CLI keys.`,
        'Open Portal',
      ],
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
    answer('Open Portal');
    await settled();
    expect(api.env.openExternal).toHaveBeenCalledWith({ url: PAGE });
  });

  test('the device flow opens the page its code carries', async () => {
    const { api, account } = await setup({
      login: {
        documents: [
          { type: 'code', code: 'WDJB-MJHT', verificationUrl: 'https://github.com/login/device' },
          {
            type: 'result',
            user: { id: 'usr_1', email: 'dev@example.com', name: 'Dev' },
            replacedKey: { revocation: 'none' },
          },
        ],
      },
    });
    await account.signIn();
    expect(api.env.openExternal).toHaveBeenCalledWith({ url: 'https://github.com/login/device' });
  });

  test('a cancelled sign-in says nothing; a failed one says why; neither announces a change', async () => {
    const cancelled = await setup({
      login: { fails: new CommandExitError(130, 'Error: cancelled') },
    });
    await cancelled.account.signIn();
    expect(cancelled.api.window.showErrorMessage).not.toHaveBeenCalled();
    expect(cancelled.changed).not.toHaveBeenCalled();

    const failed = await setup({
      login: { fails: new CommandExitError(1, 'Error: sign-in expired\n') },
    });
    await failed.account.signIn();
    expect(failed.api.window.showErrorMessage).toHaveBeenCalledWith(
      'Lace sign-in failed: Error: sign-in expired',
    );
    expect(failed.changed).not.toHaveBeenCalled();
  });

  test.each([
    [
      'the key Lace revoked',
      'revoked',
      'Signed out of Lace: the credentials are removed from this machine. Their API key is revoked.',
    ],
    [
      'no key saved',
      'none',
      'You were not signed in to Lace: no credentials were saved on this machine.',
    ],
  ] as const)('signing out, with %s, runs logout, says so, offers nothing and announces the change', async (_, revocation, said) => {
    const { api, account, changed } = await setup({
      logout: { documents: [{ loggedOut: true, revocation }] },
    });
    await account.signOut();
    expect(shownBy(api.window.showInformationMessage)).toEqual([[said]]);
    expect(api.window.showWarningMessage).not.toHaveBeenCalled();
    expect(api.env.openExternal).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  const PORTAL = 'https://lace.example.com/account';
  const LIVE = 'The key may still be live. Revoke it in the portal under Account, CLI keys.';
  test.each([
    [
      'refused',
      'the Lace server that issued this key does not accept it',
      'Signed out of Lace: the credentials are removed from this machine. Lace did not revoke their API key: the Lace server that issued this key does not accept it.',
    ],
    [
      'unreachable',
      'dial tcp: connection refused',
      'Signed out of Lace: the credentials are removed from this machine. Lace could not be reached to revoke their API key: dial tcp: connection refused.',
    ],
    [
      'unreadable',
      'open credentials.json: permission denied',
      'Signed out of Lace: the credentials are removed from this machine. They could not be read, so their API key was not revoked: open credentials.json: permission denied.',
    ],
  ] as const)('signing out with the key %s announces the change, warns that the key may still be live, and Open Portal opens the page the result names', async (revocation, detail, said) => {
    const { api, account, changed } = await setup({
      logout: { documents: [{ loggedOut: true, revocation, detail, portalUrl: PORTAL }] },
    });
    let answer: (title: string) => void = () => {};
    api.window.showWarningMessage.mockImplementationOnce(
      () => new Promise<string | undefined>((resolve) => (answer = resolve)),
    );
    await account.signOut();
    expect(shownBy(api.window.showWarningMessage)).toEqual([[`${said} ${LIVE}`, 'Open Portal']]);
    expect(api.window.showInformationMessage).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(api.env.openExternal).not.toHaveBeenCalled();

    answer('Open Portal');
    await settled();
    expect(api.env.openExternal).toHaveBeenCalledWith({ url: PORTAL });
  });
});

describe('the status bar', () => {
  test('names the selection and where it came from', () => {
    expect(
      selectionStatus({ organization: current('acme'), team: current('platform', 'env') }),
    ).toEqual({
      text: '$(organization) acme · platform',
      tooltip:
        "Organization: acme (saved by lace org use or lace team use)\nTeam: platform (set by the Lace engine's environment)",
    });
    expect(selectionStatus({ organization: current(null), team: current(null) })).toEqual({
      text: '$(organization) No Lace organization',
      tooltip: 'No organization selected\nNo team selected',
    });
  });

  test('reads the selection at start, after a change, and when the account changed outside this window', async () => {
    const scripts: Record<string, Script> = {
      whoami: { documents: [signedInAs('usr_1')] },
      'org list': { documents: [ORGS] },
      'org current': { documents: [current('acme')] },
      'org use': { documents: [{ organization: 'globex', team: null }] },
      'team list': { documents: [teams()] },
      'team current': { documents: [current(null)] },
    };
    const { account, commands, outside } = await setup(scripts as never, ['globex']);
    const status = {
      text: '',
      tooltip: '',
      command: '',
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    };
    const registered: string[] = [];
    const controls = accountControls(
      {
        commands: {
          registerCommand: (id: string) => {
            registered.push(id);
            return { dispose: () => {} };
          },
        },
        window: {
          createStatusBarItem: () => status,
          showErrorMessage: vi.fn(),
        },
      } as never,
      account,
      commands.commands,
      {} as never,
      vi.fn(),
    );
    await settled();
    expect(status.text).toBe('$(organization) acme');
    expect(status.command).toBe(SELECT_ORGANIZATION);

    scripts['org current'] = { documents: [current('globex')] };
    await account.selectOrganization();
    await settled();
    expect(status.text).toBe('$(organization) globex');

    scripts['org current'] = { documents: [current('initech', 'env')] };
    outside.focus();
    await settled();
    expect(status.text).toBe('$(organization) initech');
    expect(registered).toEqual([
      'lace.signIn',
      'lace.signOut',
      'lace.selectOrganization',
      'lace.selectTeam',
    ]);
    controls.dispose();
  });
});

describe('the account changed outside this window', () => {
  // The account a developer signed in as `usr_1` with `acme` selected has:
  // scripts the test changes as a terminal would.
  const signedIn = (): Record<string, Script> => ({
    whoami: { documents: [signedInAs('usr_1')] },
    'org current': { documents: [current('acme')] },
    'team current': { documents: [current('platform')] },
  });
  const reads = (invoked: readonly Invoked[]) =>
    invoked.filter((call) => call.path === 'whoami').length;

  test('the window regaining focus reads the account, and announces nothing while it is as it was', async () => {
    const { commands, changed, outside } = await setup(signedIn() as never);
    expect(reads(commands.invoked)).toBe(1);

    outside.focus();
    await settled();
    outside.focus(false);
    await settled();

    expect(reads(commands.invoked)).toBe(2);
    expect(changed).not.toHaveBeenCalled();
  });

  test('a focus that reads another selection announces it once', async () => {
    const scripts = signedIn();
    const { changed, outside } = await setup(scripts as never);

    scripts['org current'] = { documents: [current('globex')] };
    outside.focus();
    await settled();
    outside.focus();
    await settled();

    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('a lace command ending in the integrated terminal reads the account: lace logout announces the sign-out', async () => {
    const scripts = signedIn();
    const { commands, changed, outside } = await setup(scripts as never);

    outside.ended('git status');
    outside.ended('echo lace logout');
    await settled();
    expect(reads(commands.invoked)).toBe(1);

    scripts.whoami = SIGNED_OUT;
    outside.ended('lace logout');
    await settled();
    expect(changed).toHaveBeenCalledTimes(1);

    outside.ended('lace whoami');
    await settled();
    expect(reads(commands.invoked)).toBe(3);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('another developer signed in is another account', async () => {
    const scripts = signedIn();
    const { changed, outside } = await setup(scripts as never);
    scripts.whoami = { documents: [signedInAs('usr_2')] };
    outside.ended('lace login');
    await settled();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('a change this window makes is announced once, and the focus after it finds the account as it is now', async () => {
    let signedOut = false;
    const { account, changed, outside } = await setup({
      ...signedIn(),
      whoami: () => (signedOut ? SIGNED_OUT : { documents: [signedInAs('usr_1')] }),
      logout: () => {
        signedOut = true;
        return { documents: [{ loggedOut: true, revocation: 'revoked' }] };
      },
    } as never);
    await account.signOut();
    await settled();
    expect(changed).toHaveBeenCalledTimes(1);

    outside.focus();
    await settled();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('a read that fails is reported and announces nothing; once disposed, the window is not listened to', async () => {
    const { account, changed, outside, report, commands } = await setup({
      ...signedIn(),
      whoami: { fails: new Error('the engine stopped') },
    } as never);
    outside.focus();
    await settled();
    expect(changed).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('reading the Lace account', expect.any(Error));

    account.dispose();
    outside.focus();
    outside.ended('lace logout');
    await settled();
    expect(reads(commands.invoked)).toBe(2);
  });
});

describe('an account command that fails', () => {
  // The account's palette commands over `account`, with a window whose error
  // notices answer Sign In.
  function controls(account: Account, commands: ReturnType<typeof fakeCommands>) {
    const handlers = new Map<string, () => Promise<void>>();
    const window = {
      createStatusBarItem: () => ({ show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }),
      showErrorMessage: vi.fn(async (_text: string, ...buttons: Button[]) =>
        clicked(buttons, 'Sign In'),
      ),
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
    };
    const offers = {
      signIn: vi.fn(),
      selectOrganization: vi.fn(),
      selectTeam: vi.fn(),
      validate: vi.fn(),
      openPortal: vi.fn(),
      install: vi.fn(),
      openRecord: vi.fn(),
    };
    accountControls(
      {
        commands: {
          registerCommand: (id: string, run: () => Promise<void>) => {
            handlers.set(id, run);
            return { dispose: () => {} };
          },
        },
        window,
      } as never,
      account,
      commands.commands,
      offers,
      vi.fn(),
    );
    return { window, offers, run: async (id: string) => handlers.get(id)?.() };
  }

  test('says why with the ways out its reason names', async () => {
    const { account, commands } = await setup({
      'org list': refused({ reason: 'unauthenticated', message: 'no credentials' }),
      'org current': { documents: [current(null)] },
    });
    const { window, offers, run } = controls(account, commands);
    await run(SELECT_ORGANIZATION);
    expect(shownBy(window.showErrorMessage)).toEqual([['no credentials', 'Sign In']]);
    expect(offers.signIn).toHaveBeenCalledTimes(1);
  });

  test('a read whose stream ended says to run that read again', async () => {
    const { account, commands } = await setup({
      'org list': { fails: new CommandUnobservedError('org list') },
      'org current': { documents: [current('acme')] },
    });
    const { window, run } = controls(account, commands);
    await run(SELECT_ORGANIZATION);
    expect(shownBy(window.showErrorMessage)).toEqual([
      ["the engine's stream ended before `lace org list` exited; run it again"],
    ]);
  });

  test('a save of the organization that wrote no document says what the CLI wrote, or its exit code when it wrote nothing; one whose stream ended, that it may have made changes', async () => {
    // What Select Organization says when its `org use` fails with `fails`.
    const saying = async (fails: Error) => {
      const { account, commands } = await setup(
        {
          'org list': { documents: [ORGS] },
          'org current': { documents: [current('acme')] },
          'org use': { fails },
        },
        ['globex'],
      );
      const { window, run } = controls(account, commands);
      await run(SELECT_ORGANIZATION);
      return shownBy(window.showErrorMessage);
    };
    expect(await saying(new CommandExitError(1, 'Error: the config file is read-only\n'))).toEqual([
      ['Error: the config file is read-only'],
    ]);
    expect(await saying(new CommandExitError(2, ''))).toEqual([
      ['the command exited with code 2 and wrote nothing'],
    ]);
    expect(await saying(new CommandUnobservedError('org use'))).toEqual([
      [
        "the engine's stream ended before `lace org use` exited: it ran and may have made changes, but its outcome is unknown",
      ],
    ]);
  });
});
