import { CommandExitError } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import { fakeCommands, refused, type Script } from '../../engine/__tests__/fake-commands';
import { type Button, clicked, shownBy } from '../../vscode/__tests__/fake-messages';
import { accountControls, createAccount, SELECT_ORGANIZATION } from '../account';
import { selectionStatus } from '../scope';

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

function setup(scripts: Parameters<typeof fakeCommands>[0], picks: (string | undefined)[] = []) {
  const commands = fakeCommands(scripts);
  const api = {
    window: {
      withProgress: vi.fn(async (_options, task) =>
        task({ report: vi.fn() }, { onCancellationRequested: () => ({ dispose: () => {} }) }),
      ),
      showInformationMessage: vi.fn(
        async (_text: string, ..._actions: string[]): Promise<string | undefined> => undefined,
      ),
      showErrorMessage: vi.fn(async () => undefined),
      showQuickPick: vi.fn(async (items: { slug: string }[]) => {
        const slug = picks.shift();
        return items.find((item) => item.slug === slug);
      }),
    },
    env: { openExternal: vi.fn(async () => true), clipboard: { writeText: vi.fn(async () => {}) } },
    Uri: { parse: (url: string) => ({ url }) },
    ProgressLocation: { Notification: 15 },
  };
  const account = createAccount(commands.commands, api as never);
  const changed = vi.fn();
  account.onDidChange(changed);
  return { commands, api, account, changed };
}

describe('selecting the organization', () => {
  test('picks from org list, marks the current one, runs org use and goes on to the team', async () => {
    const { commands, api, account, changed } = setup(
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

    const [orgItems, orgOptions] = api.window.showQuickPick.mock.calls[0] as never as [
      { label: string; description: string }[],
      { placeHolder: string },
    ];
    expect(orgItems.map((item) => [item.label, item.description])).toEqual([
      ['Acme', 'acme · current'],
      ['Globex', 'globex'],
    ]);
    expect(orgOptions.placeHolder).toBe('Select a Lace organization');
    expect(
      commands.invoked.filter((c) => c.path.startsWith('team ')).map((c) => [c.path, c.args]),
    ).toEqual([
      ['team list', { org: 'globex' }],
      ['team current', { org: 'globex' }],
      ['team use', { team: 'data', org: 'globex' }],
    ]);
    expect(commands.invoked.filter((c) => c.path.endsWith(' use')).map((c) => c.path)).toEqual([
      'org use',
      'team use',
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('with the organization set by the environment, the pick says so', async () => {
    const { api, account } = setup({
      'org list': { documents: [ORGS] },
      'org current': { documents: [current('acme', 'env')] },
    });
    await account.selectOrganization();
    const [, options] = api.window.showQuickPick.mock.calls[0] as never as [
      unknown,
      { placeHolder: string },
    ];
    expect(options.placeHolder).toBe(
      "The Lace engine's environment sets the organization; the choice made here is saved and applies once that variable is unset",
    );
  });

  test('dismissing the pick saves nothing and announces nothing', async () => {
    const { commands, account, changed } = setup({
      'org list': { documents: [ORGS] },
      'org current': { documents: [current('acme')] },
    });
    await account.selectOrganization();
    expect(commands.paths()).not.toContain('org use');
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('selecting the team', () => {
  test('lists and saves a team of the current organization, naming none', async () => {
    const { commands, account } = setup(
      {
        'team list': { documents: [teams('platform', 'data')] },
        'team current': { documents: [current('platform')] },
        'team use': { documents: [{ organization: 'acme', team: 'data' }] },
      },
      ['data'],
    );
    await account.selectTeam();
    expect(commands.invoked.map((c) => [c.path, c.args])).toEqual([
      ['team list', {}],
      ['team current', {}],
      ['team use', { team: 'data' }],
    ]);
  });

  test('an organization with no team says teams are made in the portal, with no empty pick', async () => {
    const { api, account, commands, changed } = setup({
      'team list': { documents: [teams()] },
      'team current': { documents: [current(null)] },
    });
    await account.selectTeam();
    expect(api.window.showQuickPick).not.toHaveBeenCalled();
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
    const { api, account } = setup({
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
    const { api, account, changed, commands } = setup({
      login: {
        documents: [
          { type: 'code', code: 'ABCD-2345' },
          { type: 'url', url: 'https://lace.example.com/auth/cli?pollKey=pk_1' },
          { type: 'code', code: 'ABCD-2345' },
          { type: 'url', url: 'https://lace.example.com/auth/cli?pollKey=pk_1' },
          { type: 'result', user: { id: 'usr_1', email: 'dev@example.com', name: 'Dev' } },
        ],
      },
    });
    await account.signIn();

    expect(commands.invoked.map((c) => [c.path, c.args])).toEqual([['login', {}]]);
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

  test('the device flow opens the page its code carries', async () => {
    const { api, account } = setup({
      login: {
        documents: [
          { type: 'code', code: 'WDJB-MJHT', verificationUrl: 'https://github.com/login/device' },
          { type: 'result', user: { id: 'usr_1', email: 'dev@example.com', name: 'Dev' } },
        ],
      },
    });
    await account.signIn();
    expect(api.env.openExternal).toHaveBeenCalledWith({ url: 'https://github.com/login/device' });
  });

  test('a cancelled sign-in says nothing; a failed one says why; neither announces a change', async () => {
    const cancelled = setup({ login: { fails: new CommandExitError(130, 'Error: cancelled') } });
    await cancelled.account.signIn();
    expect(cancelled.api.window.showErrorMessage).not.toHaveBeenCalled();
    expect(cancelled.changed).not.toHaveBeenCalled();

    const failed = setup({ login: { fails: new CommandExitError(1, 'Error: sign-in expired\n') } });
    await failed.account.signIn();
    expect(failed.api.window.showErrorMessage).toHaveBeenCalledWith(
      'Lace sign-in failed: Error: sign-in expired',
    );
    expect(failed.changed).not.toHaveBeenCalled();
  });

  test('signing out runs logout and announces the change', async () => {
    const { api, account, changed } = setup({ logout: { documents: [{ loggedOut: true }] } });
    await account.signOut();
    expect(api.window.showInformationMessage).toHaveBeenCalledWith('Signed out of Lace.');
    expect(changed).toHaveBeenCalledTimes(1);
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

  test('reads the selection at start, after a change and when the window regains focus', async () => {
    const scripts: Record<string, Script> = {
      'org list': { documents: [ORGS] },
      'org current': { documents: [current('acme')] },
      'org use': { documents: [{ organization: 'globex', team: null }] },
      'team list': { documents: [teams()] },
      'team current': { documents: [current(null)] },
    };
    const { account, commands } = setup(scripts as never, ['globex']);
    const status = {
      text: '',
      tooltip: '',
      command: '',
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    };
    const windowState = new Set<(s: { focused: boolean }) => void>();
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
          onDidChangeWindowState: (listener: (s: { focused: boolean }) => void) => {
            windowState.add(listener);
            return { dispose: () => windowState.delete(listener) };
          },
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
    for (const listener of windowState) listener({ focused: true });
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

describe('an account command that fails', () => {
  test('says why with the ways out its reason names', async () => {
    const { account, commands } = setup({
      'org list': refused({ reason: 'unauthenticated', message: 'no credentials' }),
      'org current': { documents: [current(null)] },
    });
    const handlers = new Map<string, () => Promise<void>>();
    const window = {
      createStatusBarItem: () => ({ show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }),
      onDidChangeWindowState: () => ({ dispose: () => {} }),
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
    await handlers.get(SELECT_ORGANIZATION)?.();
    expect(shownBy(window.showErrorMessage)).toEqual([['no credentials', 'Sign In']]);
    expect(offers.signIn).toHaveBeenCalledTimes(1);
  });
});
