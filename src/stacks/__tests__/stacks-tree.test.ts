import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CommandExitError,
  type CommandFailure,
  type CommandRun,
  type LaceReason,
} from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { authoringCommands } from '../../commands/authoring-commands';
import { fakeCommands, refused } from '../../engine/__tests__/fake-commands';
import { createRunnerHost } from '../../engine/runner-host';
import { folder, uri } from '../../roots/__tests__/fake-uri';
import type { AuthoringRoot, RootSources } from '../../roots/authoring-roots';
import { createRootState } from '../../state/root-state';
import { formAnswerer } from '../../vscode/form-answerer';
import { type OfferActions, offeringPresenter } from '../../vscode/offers';
import { createRunOutput } from '../run-output';
import { stackPick } from '../stack-pick';
import { type Row, STACK_COMMANDS, STACKS_CHOICE, STACKS_STATE, stacksTree } from '../stacks-tree';
import { memento, stack, stacks } from './stack-fixtures';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

// What the manifest contributes to the Stacks view: its welcomes, each
// selected by its `when`, and its title bar's entries.
const contributes = JSON.parse(
  readFileSync(join(resolve(__dirname, '..', '..', '..'), 'package.json'), 'utf8'),
).contributes as {
  viewsWelcome: { view: string; when?: string; contents: string }[];
  menus: Record<string, { command: string; when?: string }[]>;
};
const welcomesOf = (state: string) =>
  contributes.viewsWelcome.filter(
    (welcome) => welcome.view === 'laceStacks' && welcome.when === `lace.stacks.state == ${state}`,
  );
const linksIn = (contents: string): string[] =>
  [...contents.matchAll(/\(command:([\w.]+)\)/g)].map(([, command]) => command);
const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };
const staging: AuthoringRoot = { folder: repo, relative: 'infra/staging' };

const TEAM_CREATE_URL = 'https://portal/o/acme/teams/new';
// `team list` of the current organization: its teams, by slug.
const teams = (...slugs: string[]) => ({
  items: slugs.map((slug) => ({
    id: `team_${slug}`,
    orgId: 'org_1',
    name: slug,
    slug,
    description: '',
    createdBy: 'usr_1',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    role: 'member',
    memberCount: 1,
  })),
  nextCursor: null,
  hasMore: false,
  createUrl: TEAM_CREATE_URL,
});

const run = (id: string, status: string, url?: string) => ({
  id,
  stackId: 'stk_1',
  orgId: 'org_1',
  teamId: 'team_1',
  kind: 'apply',
  status,
  initiatedByUserId: null,
  initiatedVia: 'cli',
  runnerIdentity: null,
  runnerLocation: null,
  bundleSnapshotId: null,
  sourceCommitSha: null,
  sourceRef: null,
  sourcePrUrl: null,
  sourceOverride: false,
  planResourceAdd: 1,
  planResourceChange: 2,
  planResourceDestroy: 0,
  planLocation: null,
  planHumanLocation: null,
  applyLogLocation: null,
  policyResultsLocation: null,
  policyPassed: null,
  policyResolution: null,
  changeRequestId: null,
  cancelReason: null,
  startedAt: null,
  completedAt: null,
  errorMessage: null,
  sourceTreeHash: null,
  attestationStatus: null,
  attestedAt: null,
  attestation: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...(url === undefined ? {} : { url }),
});
const runs = (...items: ReturnType<typeof run>[]) => ({ items, nextCursor: null, hasMore: false });
// The Advisories of a preview of a stack no Agent is bound at Preview on.
const NO_AGENT = {
  queue: { manifestation: 'preview', floor: 0.5, entries: [], belowFloor: 0 },
  truncated: false,
  pending: 0,
  bound: 0,
};
const applyResult = (error: string | null = null) => ({
  type: 'result',
  run: run('run_9', error ? 'apply_failed' : 'apply_succeeded'),
  summary: { resourceAdd: 1, resourceChange: 0, resourceDestroy: 0 },
  workspaceDir: '/cache',
  error,
});
// A failure document whose message is its reason.
const refusal = (reason: LaceReason, extra: Partial<CommandFailure> = {}) =>
  refused({ reason, message: reason, ...extra });

class Emitter<T> {
  listeners = new Set<(value: T) => void>();
  event = (listener: (value: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value: T) {
    for (const listener of [...this.listeners]) listener(value);
  }
  dispose() {}
}

type Options = {
  scripts: Parameters<typeof fakeCommands>[0];
  root?: AuthoringRoot;
  // What each message the window shows answers, by its text: now, or once
  // the promise settles.
  answers?: Record<string, string | Promise<string>>;
  // What each pick picks, in order: a stack by its slug, a cloud connection
  // by its id, a module by its path in the workspace.
  picks?: string[];
  // What each input box answers, in order.
  inputs?: string[];
  // The workspace's Terraform files; two module directories by default.
  terraformFiles?: string[];
  // The canvases open in the window, focused or not; the active one by
  // default.
  openCanvases?: AuthoringRoot[];
  // The workspace's folders; one by default.
  folders?: vscode.WorkspaceFolder[];
};

function setup(options: Options) {
  const commands = fakeCommands(options.scripts);
  const mapping = commands.commands;
  let provider: vscode.TreeDataProvider<Row> | undefined;
  const view = {
    description: undefined as string | undefined,
    message: undefined as string | undefined,
    selection: new Emitter<{ selection: Row[] }>(),
    visibility: new Emitter<{ visible: boolean }>(),
    onDidChangeSelection: (l: never) => view.selection.event(l),
    onDidChangeVisibility: (l: never) => view.visibility.event(l),
    dispose: vi.fn(),
  };
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const contexts: unknown[] = [];
  // Each value the view gave `lace.stacks.choice`.
  const choices: unknown[] = [];
  const messages: { level: string; text: string; buttons: string[] }[] = [];
  const answer = (level: string) =>
    vi.fn(async (text: string, ...buttons: string[]) => {
      messages.push({ level, text, buttons });
      return options.answers?.[text];
    });
  const channels = new Map<string, string[]>();
  const shownChannels: string[] = [];
  let content: vscode.TextDocumentContentProvider | undefined;
  const opened: string[] = [];
  const progress: { title?: string; reports: string[]; cancel: () => void }[] = [];
  const activeEditor = new Emitter<unknown>();
  // A change of the workspace's folders, told once `folders` holds them.
  const workspaceFolders = new Emitter<vscode.WorkspaceFoldersChangeEvent>();
  const api = {
    window: {
      createTreeView: (_id: string, { treeDataProvider }: { treeDataProvider: never }) => {
        provider = treeDataProvider;
        return view;
      },
      showQuickPick: vi.fn(async (items: { stack?: { slug: string }; id?: string }[]) => {
        const picked = options.picks?.shift();
        return items.find((item) => (item.stack?.slug ?? item.id) === picked);
      }),
      showInputBox: vi.fn(async () => options.inputs?.shift()),
      withProgress: vi.fn(
        async (opts: { title?: string }, task: (p: never, t: never) => unknown) => {
          const cancelled = new Emitter<void>();
          const entry = {
            title: opts.title,
            reports: [] as string[],
            cancel: () => cancelled.fire(),
          };
          progress.push(entry);
          return task(
            { report: ({ message }: { message: string }) => entry.reports.push(message) } as never,
            { onCancellationRequested: cancelled.event } as never,
          );
        },
      ),
      showInformationMessage: answer('info'),
      showWarningMessage: answer('warn'),
      showErrorMessage: answer('error'),
      setStatusBarMessage: vi.fn(),
      onDidChangeActiveTextEditor: activeEditor.event,
      showTextDocument: vi.fn(async () => {}),
      createOutputChannel: (name: string) => {
        const lines: string[] = [];
        channels.set(name, lines);
        return {
          appendLine: (line: string) => lines.push(line),
          show: () => shownChannels.push(name),
          dispose: () => {},
        };
      },
    },
    workspace: {
      workspaceFolders: [repo],
      textDocuments: [],
      registerTextDocumentContentProvider: (
        _scheme: string,
        made: vscode.TextDocumentContentProvider,
      ) => {
        content = made;
        return { dispose: () => {} };
      },
      openTextDocument: vi.fn(async (u: { path: string }) => {
        opened.push(String(content?.provideTextDocumentContent(u as never, {} as never)));
        return {};
      }),
      onDidChangeWorkspaceFolders: workspaceFolders.event,
    },
    commands: {
      registerCommand: (id: string, run: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(id, run);
        return { dispose: () => {} };
      },
      executeCommand: vi.fn(async (_command: string, key: string, value: unknown) => {
        if (key === STACKS_STATE) contexts.push(value);
        if (key === STACKS_CHOICE) choices.push(value);
      }),
    },
    env: { openExternal: vi.fn(async () => true) },
    Uri: {
      parse: (url: string) => ({ url }),
      from: ({ scheme, path }: { scheme: string; path: string }) => ({ scheme, path }),
    },
    EventEmitter: Emitter,
    ThemeIcon: class {
      constructor(readonly id: string) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ProgressLocation: { Notification: 15 },
  };
  const offers: OfferActions = {
    signIn: vi.fn(),
    selectOrganization: vi.fn(),
    selectTeam: vi.fn(),
    openPortal: vi.fn(),
    install: vi.fn(),
    openRecord: vi.fn(),
  };
  const runOutput = createRunOutput(api.window as never);
  const ran: CommandRun[] = [];
  const rootState = createRootState(memento());
  const active = new Emitter<AuthoringRoot>();
  const panels = {
    tick: vi.fn(),
    onDidChangeActive: (l: (root: AuthoringRoot) => void) => {
      const { dispose } = active.event(l);
      return dispose;
    },
  };
  // Each search of the workspace for its Terraform files.
  const terraformFiles = vi.fn(async () =>
    (
      options.terraformFiles ?? [
        '/work/repo/infra/prod/main.tf',
        '/work/repo/infra/staging/main.tf',
      ]
    ).map((path) => uri(path)),
  );
  const sources: RootSources = {
    folders: () => options.folders ?? [repo],
    activeCanvas: () => options.root,
    openCanvases: () => options.openCanvases ?? (options.root ? [options.root] : []),
    activeTerraformDirectory: () => undefined,
    terraformFiles,
    pick: async (roots) => {
      const relative = options.picks?.shift();
      return roots.find((r) => r.relative === relative);
    },
  };
  const account = new Emitter<void>();
  const report = vi.fn();
  const runner = createRunnerHost({
    commands: () => mapping.anywhere(),
    presenter: offeringPresenter({
      api: api as never,
      actions: offers,
      confirm: async () => true,
      // The palette's Validate, built below over the same commands.
      validate: (root) => modules.validate(root),
      sources,
      report: vi.fn(),
    }),
    answerer: formAnswerer({ api: api as never, commands: mapping, offers, sources, report }),
    onRunLog: (line, made) => {
      ran.push(made);
      runOutput.append(line, made);
    },
  });
  // The palette's module commands over the same commands, whose Validate a
  // notice about a root offers.
  const log = {
    lines: [] as string[],
    appendLine: (line: string) => log.lines.push(line),
    show: vi.fn(),
  };
  const modules = authoringCommands({
    api: api as never,
    sources,
    operations: { save: vi.fn(), generate: vi.fn(), held: () => false },
    commands: mapping,
    log,
    offers,
  });
  const tree = stacksTree({
    api: api as never,
    commands: mapping,
    runner,
    runOutput,
    account: { onDidChange: (l) => account.event(l).dispose },
    offers,
    rootState,
    panels,
    sources,
    pickStack: stackPick({ api: api as never, commands: mapping, rootState, sources, offers }),
    validate: modules.validate,
    report,
  });
  const children = async (row?: Row) => (await provider?.getChildren(row)) ?? [];
  const redrawn: (Row | undefined)[] = [];
  provider?.onDidChangeTreeData?.((row) => {
    redrawn.push(row as Row | undefined);
  });
  const item = (row: Row) => provider?.getTreeItem(row) as vscode.TreeItem;
  const command = (id: string, ...args: unknown[]) => handlers.get(id)?.(...args);
  return {
    api,
    commands,
    view,
    tree,
    children,
    item,
    command,
    contexts,
    choices,
    messages,
    channels,
    shownChannels,
    opened,
    progress,
    offers,
    runner,
    ran,
    rootState,
    panels,
    active,
    account,
    report,
    redrawn,
    log,
    terraformFiles,
    workspaceFolders,
  };
}

// What `module validate` reports for a root: its verdict and diagnostics.
// A loss report stops at its verdict, so what its run never reached (the
// deviation, Terraform's validate, the resolved children) is absent.
const validation = (root: string, diagnostics: object[]) => ({
  root,
  treeHash: 'h',
  verdict: 'lossy',
  residuals: [],
  exitClass: 'parse',
  diagnostics,
});

describe('the stacks of the current root', () => {
  test('are listed from stack list --source, and the view names the root', async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'), stack('stk_2', 'qa'))] },
      },
    });
    const rows = await t.children();

    expect(t.commands.invoked.map((c) => [c.path, c.args])).toEqual([
      ['stack list', { source: '/work/repo/infra/prod' }],
    ]);
    expect(t.view.description).toBe('infra/prod');
    expect(t.contexts).toEqual(['stacks']);
    expect(rows.map((row) => t.item(row).label)).toEqual(['Prod', 'Qa']);
    expect(t.item(rows[0])).toMatchObject({
      description: 'prod',
      contextValue: 'laceStack',
      collapsibleState: 1,
      iconPath: { id: 'layers' },
    });
  });

  test('a stack expands to its recent runs; a run with a page offers it', async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'run list': {
          documents: [
            runs(
              run('run_1', 'apply_succeeded', 'https://portal/o/t/stacks/stk_1/runs/run_1'),
              run('run_2', 'plan_failed'),
            ),
          ],
        },
      },
    });
    const [prodRow] = await t.children();
    const runRows = await t.children(prodRow);

    expect(t.commands.invoked.at(-1)).toMatchObject({
      path: 'run list',
      args: { stack: 'stk_1', limit: 10 },
    });
    expect(runRows.map((row) => t.item(row))).toMatchObject([
      {
        label: 'apply · run_1',
        description: 'apply_succeeded · +1 ~2 -0',
        contextValue: 'laceRun portal',
        iconPath: { id: 'pass-filled' },
      },
      { label: 'apply · run_2', contextValue: 'laceRun', iconPath: { id: 'error' } },
    ]);

    await t.command(STACK_COMMANDS.openInPortal, runRows[0]);
    expect(t.api.env.openExternal).toHaveBeenCalledWith({
      url: 'https://portal/o/t/stacks/stk_1/runs/run_1',
    });
  });

  test('turning to a canvas whose folder has left the workspace leaves the view on its root', async () => {
    const api = folder('/work/api', 0);
    const web = folder('/work/web', 1);
    const t = setup({
      folders: [api],
      terraformFiles: ['/work/api/infra/prod/main.tf'],
      scripts: { 'stack list': { documents: [stacks()] } },
    });
    await t.children();
    expect(t.view.description).toBe('infra/prod');

    t.active.fire({ folder: web, relative: 'infra/prod' });
    expect(t.redrawn).toEqual([]);
    await t.children();
    expect(t.view.description).toBe('infra/prod');
    expect(t.commands.invoked.map((c) => c.args)).toEqual([
      { source: '/work/api/infra/prod' },
      { source: '/work/api/infra/prod' },
    ]);
  });

  test('follows the canvas the developer turns to', async () => {
    const t = setup({ root: prod, scripts: { 'stack list': { documents: [stacks()] } } });
    await t.children();
    t.active.fire(staging);
    expect(t.redrawn).toEqual([undefined]);
    await t.children();
    expect(t.view.description).toBe('infra/staging');
    expect(t.commands.invoked.at(-1)?.args).toEqual({ source: '/work/repo/infra/staging' });
  });

  test("in a workspace of several folders, the view names its root as the root's canvas tab is titled", async () => {
    const api = folder('/work/api', 0);
    const web = folder('/work/web', 1);
    const t = setup({
      root: { folder: api, relative: 'infra/prod' },
      folders: [api, web],
      terraformFiles: ['/work/api/infra/prod/main.tf', '/work/web/infra/prod/main.tf'],
      scripts: { 'stack list': { documents: [stacks()] } },
    });
    await t.children();
    expect(t.view.description).toBe('api/infra/prod');
  });

  test("when the workspace's folders change, the view names its root by the folders open now, and finds another when its root's folder left", async () => {
    const api = folder('/work/api', 0);
    const web = folder('/work/web', 1);
    const folders = [api];
    const t = setup({
      folders,
      terraformFiles: ['/work/api/infra/prod/main.tf', '/work/web/infra/prod/main.tf'],
      scripts: { 'stack list': { documents: [stacks()] } },
    });
    await t.children();
    expect(t.view.description).toBe('infra/prod');

    folders.push(web);
    t.workspaceFolders.fire({ added: [web], removed: [] });
    expect(t.redrawn).toEqual([undefined]);
    await t.children();
    expect(t.view.description).toBe('api/infra/prod');

    t.active.fire({ folder: web, relative: 'infra/prod' });
    await t.children();
    expect(t.view.description).toBe('web/infra/prod');

    folders.pop();
    t.workspaceFolders.fire({ added: [], removed: [web] });
    expect(t.redrawn).toEqual([undefined, undefined, undefined]);
    await t.children();
    expect(t.view.description).toBe('infra/prod');
    expect(t.commands.invoked.map((c) => c.args)).toEqual([
      { source: '/work/api/infra/prod' },
      { source: '/work/api/infra/prod' },
      { source: '/work/web/infra/prod' },
      { source: '/work/api/infra/prod' },
    ]);
  });

  test('with several modules and none focused, the view offers the pick; the pick shows the chosen root', async () => {
    const t = setup({
      scripts: { 'stack list': { documents: [stacks()] } },
      picks: ['infra/staging'],
    });
    expect(await t.children()).toEqual([]);
    expect(t.contexts).toEqual(['severalModules']);
    expect(t.commands.invoked).toEqual([]);

    await t.command(STACK_COMMANDS.chooseModule);
    await t.children();
    expect(t.view.description).toBe('infra/staging');
    expect(t.contexts.at(-1)).toBe('noStack');
  });

  test.each<[string, Omit<Options, 'scripts'>, string, string, string[]]>([
    [
      'no folder is open',
      { folders: [] },
      'noFolder',
      'No folder is open. Open the folder that holds the module to see the stacks deployed from it.',
      [],
    ],
    [
      'no directory holds a module',
      { terraformFiles: [] },
      'noModule',
      'No directory in this workspace holds a module yet. Start one on the canvas.\n[Open Canvas](command:lace.openCanvas)',
      ['lace.openCanvas'],
    ],
    [
      'several directories hold one',
      {},
      'severalModules',
      'Several directories in this workspace hold a module. Choose one to see the stacks deployed from it.\n[Choose Module](command:lace.stacks.chooseModule)',
      ['lace.stacks.chooseModule'],
    ],
  ])('with no root to name because %s, the view shows that reason’s welcome and lists nothing', async (_why, over, state, contents, links) => {
    const t = setup({ scripts: {}, ...over });
    expect(await t.children()).toEqual([]);
    expect(t.contexts).toEqual([state]);
    expect(t.commands.invoked).toEqual([]);
    expect(t.view.description).toBeUndefined();

    const welcomes = welcomesOf(state);
    expect(welcomes).toHaveLength(1);
    expect(welcomes[0].contents).toBe(contents);
    expect(linksIn(welcomes[0].contents)).toEqual(links);
  });

  test('no welcome of the view is selected by a state it does not have', () => {
    expect(contributes.viewsWelcome.filter((welcome) => welcome.when?.includes('noRoot'))).toEqual(
      [],
    );
  });

  test('with no module yet, the canvas the developer opens is the root the view follows', async () => {
    const t = setup({ scripts: { 'stack list': { documents: [stacks()] } }, terraformFiles: [] });
    await t.children();
    expect(t.contexts).toEqual(['noModule']);

    t.active.fire({ folder: repo, relative: '' });
    expect(t.redrawn).toEqual([undefined]);
    await t.children();
    expect(t.view.description).toBe('repo');
    expect(t.commands.invoked.map((c) => [c.path, c.args])).toEqual([
      ['stack list', { source: '/work/repo' }],
    ]);
  });

  test('each read of the tree searches the workspace for Terraform once, with a root or without', async () => {
    const listed = { 'stack list': { documents: [stacks()] } };
    const rootless = setup({ scripts: listed });
    await rootless.children();
    expect(rootless.contexts).toEqual(['severalModules']);
    expect(rootless.terraformFiles).toHaveBeenCalledOnce();

    const rooted = setup({ root: prod, scripts: listed });
    await rooted.children();
    await rooted.children();
    expect(rooted.terraformFiles).toHaveBeenCalledTimes(2);
  });

  test('Show Stacks of a Module is in the title bar while more than one module is there to choose among, read on each read', async () => {
    const [title, ...more] = contributes.menus['view/title'].filter(
      (entry) => entry.command === STACK_COMMANDS.chooseModule,
    );
    expect(more).toEqual([]);
    expect(title.when).toBe('view == laceStacks && lace.stacks.choice');

    const listed = { 'stack list': { documents: [stacks()] } };
    const none = setup({ scripts: listed, terraformFiles: [] });
    await none.children();
    expect(none.choices).toEqual([false]);

    const one = setup({
      root: prod,
      scripts: listed,
      terraformFiles: ['/work/repo/infra/prod/main.tf'],
    });
    await one.children();
    await one.children();
    expect(one.choices).toEqual([false, false]);

    const two = setup({ root: prod, scripts: listed });
    await two.children();
    expect(two.choices).toEqual([true]);

    // A canvas focused on a directory with no Terraform, beside one that
    // holds Terraform, is a second module to choose.
    const beside = setup({
      root: { folder: repo, relative: 'infra/new' },
      scripts: listed,
      terraformFiles: ['/work/repo/infra/prod/main.tf'],
    });
    await beside.children();
    expect(beside.choices).toEqual([true]);
  });

  const fresh: AuthoringRoot = { folder: repo, relative: 'infra/new' };

  test('with no canvas focused, names the canvas open on a directory that holds no Terraform', async () => {
    const t = setup({
      scripts: { 'stack list': { documents: [stacks()] } },
      terraformFiles: [],
      openCanvases: [fresh],
    });
    await t.children();
    expect(t.view.description).toBe('infra/new');
    expect(t.commands.invoked.map((c) => [c.path, c.args])).toEqual([
      ['stack list', { source: '/work/repo/infra/new' }],
    ]);
  });

  test('Show Stacks of a Module, with only a canvas open on a directory that holds no Terraform, names that root and says nothing', async () => {
    const t = setup({
      scripts: { 'stack list': { documents: [stacks()] } },
      terraformFiles: [],
      openCanvases: [fresh],
    });
    await t.command(STACK_COMMANDS.chooseModule);
    await t.children();
    expect(t.messages).toEqual([]);
    expect(t.view.description).toBe('infra/new');
    expect(t.commands.invoked.at(-1)?.args).toEqual({ source: '/work/repo/infra/new' });
  });
});

describe('a stack command from the palette with no root named', () => {
  test.each([
    [STACK_COMMANDS.preview, 'preview a stack of'],
    [STACK_COMMANDS.apply, 'apply a stack of'],
    [STACK_COMMANDS.scan, 'scan a stack of'],
    [STACK_COMMANDS.chooseModule, 'show the stacks of'],
  ])('%s, in a workspace with no Terraform, says why and runs nothing', async (id, verb) => {
    const t = setup({ scripts: {}, terraformFiles: [] });
    await t.command(id);
    await settled();
    expect(t.messages).toEqual([
      {
        level: 'info',
        text: `No module to ${verb}: no directory under this workspace holds Terraform files and no canvas is open. Start one with Lace: Open Canvas.`,
        buttons: [],
      },
    ]);
    expect(t.commands.invoked).toEqual([]);
  });

  test.each([
    STACK_COMMANDS.preview,
    STACK_COMMANDS.apply,
    STACK_COMMANDS.scan,
  ])('%s on a module with no stack says so and how one is created, with no empty pick', async (id) => {
    const t = setup({ root: prod, scripts: { 'stack list': { documents: [stacks()] } } });
    await t.command(id);
    await settled();
    expect(t.messages).toEqual([
      {
        level: 'info',
        text: 'No stack is deployed from infra/prod yet. Create one in the Stacks view.',
        buttons: [],
      },
    ]);
    expect(t.api.window.showQuickPick).not.toHaveBeenCalled();
    expect(t.commands.paths()).toEqual(['stack list']);
  });

  test.each([
    STACK_COMMANDS.preview,
    STACK_COMMANDS.apply,
    STACK_COMMANDS.scan,
    STACK_COMMANDS.chooseModule,
  ])('%s, when the developer dismisses the pick of a module, says nothing and runs nothing', async (id) => {
    const t = setup({ scripts: {}, picks: [] });
    await t.command(id);
    await settled();
    expect(t.messages).toEqual([]);
    expect(t.commands.invoked).toEqual([]);
  });
});

describe('when the stacks cannot be listed', () => {
  const stateFor = async (scripts: Options['scripts']) => {
    const t = setup({ root: prod, scripts });
    await t.children();
    return t;
  };

  test('each refusal shows the welcome its reason names', async () => {
    expect((await stateFor({ 'stack list': refusal('unauthenticated') })).contexts).toEqual([
      'signedOut',
    ]);
    expect((await stateFor({ 'stack list': refusal('no_organization') })).contexts).toEqual([
      'noOrganization',
    ]);
    expect(
      (
        await stateFor({
          'stack list': refusal('no_team'),
          'team list': { documents: [teams('platform')] },
        })
      ).contexts,
    ).toEqual(['noTeam']);
  });

  test('an organization with no team offers the portal page the failure carries', async () => {
    const t = await stateFor({
      'stack list': refusal('no_team', { url: TEAM_CREATE_URL }),
      'team list': { documents: [teams()] },
    });
    expect(t.contexts).toEqual(['teamlessOrganization']);
    await t.command(STACK_COMMANDS.openPortal);
    expect(t.api.env.openExternal).toHaveBeenCalledWith({ url: TEAM_CREATE_URL });
  });

  test('any other failure says its message, and is read again after a change of account', async () => {
    const t = await stateFor({ 'stack list': refusal('unspecified') });
    expect(t.contexts).toEqual(['failed']);
    expect(t.view.message).toBe('unspecified');

    t.account.fire();
    expect(t.redrawn).toEqual([undefined]);
  });
});

describe('Create Stack', () => {
  const connections = {
    items: [
      {
        id: 'conn_1',
        name: 'AWS prod',
        provider_type: 'aws',
        status: 'ready',
        status_reason: null,
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
        metadata: {},
      },
    ],
    createUrl: 'https://portal/connections/new',
  };

  test('is the one action of the welcome a root with no stack shows', async () => {
    const t = setup({ root: prod, scripts: { 'stack list': { documents: [stacks()] } } });
    await t.children();
    expect(t.contexts).toEqual(['noStack']);
    const [welcome] = welcomesOf('noStack');
    expect(welcome.contents).toBe(
      'No stack is deployed from this module yet.\n[Create Stack](command:lace.stacks.create)',
    );
    expect(linksIn(welcome.contents)).toEqual([STACK_COMMANDS.create]);
  });

  test("runs the package's stack create in the view's root with the slug and connection the form asks for, under a progress notification until its run ends, and the view then lists the stack", async () => {
    let created = false;
    const t = setup({
      root: prod,
      scripts: {
        'stack list': () => ({ documents: [created ? stacks(stack('stk_9', 'prod')) : stacks()] }),
        'connection list': { documents: [connections] },
        'stack create': { held: true },
      },
      inputs: ['prod'],
      picks: ['conn_1'],
    });
    await t.children();
    let done = false;
    const creating = t.command(STACK_COMMANDS.create)?.then(() => {
      done = true;
    });
    await settled();

    expect(t.commands.invoked.filter((c) => c.path === 'stack create')).toEqual([
      {
        cwd: '/work/repo/infra/prod',
        path: 'stack create',
        args: { source: '/work/repo/infra/prod', slug: 'prod', connection: 'conn_1' },
      },
    ]);
    // The view's own progress, while an invocation is under way, has no title.
    expect(t.progress.flatMap((p) => p.title ?? [])).toEqual(['Create stack: infra/prod']);
    expect(done).toBe(false);

    created = true;
    t.commands.held[0].finish([stack('stk_9', 'prod')]);
    await creating;
    expect(t.messages).toContainEqual({ level: 'info', text: 'Created stack prod', buttons: [] });
    expect(t.redrawn).toContain(undefined);
    const [row] = await t.children();
    expect(row).toMatchObject({ kind: 'stack', stack: { slug: 'prod' } });
    expect(t.panels.tick).toHaveBeenCalledWith(prod);
  });

  test('a refusal of stack create says what the CLI says', async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks()] },
        'connection list': { documents: [connections] },
        'stack create': refusal('not_git_repository'),
      },
      inputs: ['prod'],
      picks: ['conn_1'],
    });
    await t.children();
    await t.command(STACK_COMMANDS.create);
    await settled();
    expect(t.messages).toContainEqual({
      level: 'error',
      text: 'Error: not_git_repository\n',
      buttons: [],
    });
  });

  test('a dismissed slug creates nothing, and the progress ends', async () => {
    const t = setup({ root: prod, scripts: { 'stack list': { documents: [stacks()] } } });
    await t.children();
    await t.command(STACK_COMMANDS.create);
    expect(t.commands.paths()).toEqual(['stack list']);
    expect(t.progress.flatMap((p) => p.title ?? [])).toEqual(['Create stack: infra/prod']);
  });
});

describe('a stack row', () => {
  const listed = { 'stack list': { documents: [stacks(stack('stk_1', 'prod'))] } };

  test('selected, is the stack picked for its root, and shows so', async () => {
    const t = setup({ root: prod, scripts: { ...listed } });
    const [row] = await t.children();
    t.view.selection.fire({ selection: [row] });
    await settled();
    expect(t.rootState.stack(prod)).toEqual({
      id: 'stk_1',
      slug: 'prod',
    });
    expect(t.item(row)).toMatchObject({
      description: 'prod · on the canvas',
      iconPath: { id: 'layers-active' },
    });
  });

  test("a Preview refused for no certification offers Validate on the run's root, which validates that root", async () => {
    const t = setup({
      root: prod,
      scripts: {
        ...listed,
        'stack preview': refusal('no_certification'),
        'module validate': { documents: [validation('/work/repo/infra/prod', [])] },
      },
      answers: { 'Error: no_certification\n': 'Validate' },
    });
    const [row] = await t.children();
    await t.command(STACK_COMMANDS.preview, row);
    await settled();
    await settled();

    expect(t.messages[0]).toEqual({
      level: 'error',
      text: 'Error: no_certification\n',
      buttons: ['Validate'],
    });
    expect(t.commands.invoked.find((c) => c.path === 'module validate')?.cwd).toBe(
      '/work/repo/infra/prod',
    );
  });

  test("runs the package's bindings over the root and the stack: Preview, Scan, Follow logs, Cancel", async () => {
    const t = setup({
      root: prod,
      scripts: {
        ...listed,
        'run list': { documents: [runs(run('run_1', 'applying'))] },
        'stack preview': {
          documents: [
            {
              stack: { id: 'stk_1', slug: 'prod' },
              treeHash: 'h1',
              plan: {
                summary: { resourceAdd: 1, resourceChange: 0, resourceDestroy: 0 },
                human: '+ aws_s3_bucket.b',
              },
              policy: null,
              advisories: NO_AGENT,
            },
          ],
        },
        'stack scan': { documents: [{ triggered: true, reason: null, settled: null }] },
        'run logs': {
          documents: [
            { type: 'log', text: 'line one' },
            { type: 'result', status: 'apply_succeeded' },
          ],
        },
        'run cancel': { documents: [run('run_1', 'cancelled')] },
      },
    });
    const [row] = await t.children();
    const [runRow] = await t.children(row);

    await t.command(STACK_COMMANDS.preview, row);
    await t.command(STACK_COMMANDS.scan, row);
    await t.command(STACK_COMMANDS.followLogs, runRow);
    await t.command(STACK_COMMANDS.cancel, runRow);
    await settled();

    const ran = t.commands.invoked.filter((c) => !c.path.endsWith('list'));
    expect(ran.map((c) => [c.path, c.args])).toEqual([
      ['stack preview', { stack: 'stk_1' }],
      ['stack scan', { stack: 'stk_1', wait: true }],
      ['run logs', { run: 'run_1', follow: true }],
      ['run cancel', { run: 'run_1' }],
    ]);
    expect(ran.find((c) => c.path === 'stack preview')?.cwd).toBe('/work/repo/infra/prod');
    expect(t.opened).toEqual([
      'Preview of prod (tree h1)\nPlan: +1 ~0 -0\n\n+ aws_s3_bucket.b\n\nPolicy: none applies\n\nAdvisories: no Agent is installed and bound at Preview\n',
    ]);
    expect(t.channels.get('Lace: prod')).toEqual(['── lace run logs run_1 ──', 'line one']);
    expect(t.shownChannels).toContain('Lace: prod');
  });
});

describe('an apply', () => {
  const lines = [
    { type: 'log', text: 'Preview Advisory:' },
    { type: 'log', text: '  + aws_s3_bucket.b' },
    { type: 'log', text: '' },
    { type: 'phase', name: 'plan' },
    { type: 'log', text: 'Still creating...' },
    { type: 'log', text: 'Still creating...' },
  ];

  test('runs over the root and stack it is given, every log line goes to the stack’s Output channel, and it settles with a notice and a tick', async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'stack apply': { documents: [...lines, applyResult()] },
      },
      answers: { 'Applied prod.': 'Show Output' },
    });
    const [row] = await t.children();
    await t.command(STACK_COMMANDS.apply, row);
    await settled();

    expect(t.commands.invoked.find((c) => c.path === 'stack apply')?.args).toEqual({
      stack: 'stk_1',
    });
    expect(t.ran.every((made) => made.ctx.root === '/work/repo/infra/prod')).toBe(true);
    expect(t.channels.get('Lace: prod')).toEqual([
      '── lace stack apply ──',
      'Preview Advisory:',
      '  + aws_s3_bucket.b',
      '',
      'Still creating...',
      'Still creating...',
    ]);
    expect(t.progress.find((p) => p.title === 'Applying prod')).toBeDefined();
    expect(t.messages).toContainEqual({
      level: 'info',
      text: 'Applied prod.',
      buttons: ['Show Output'],
    });
    expect(t.shownChannels).toEqual(['Lace: prod']);
    expect(t.panels.tick).toHaveBeenCalledWith(prod);
    // Each tick asks for the whole tree again.
    expect(t.redrawn).toContain(undefined);
  });

  test('refused for no certification on one root offers Validate, which runs the palette’s Validate on that root, whatever ran since, and shows its diagnostics', async () => {
    let click: (label: string) => void = () => {};
    const clicked = new Promise<string>((resolve) => {
      click = resolve;
    });
    const t = setup({
      root: staging,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_s', 'staging'))] },
        'stack apply': refusal('no_certification'),
        'stack preview': {
          documents: [
            {
              stack: { id: 'stk_p', slug: 'prod' },
              treeHash: 'h1',
              plan: {
                summary: { resourceAdd: 0, resourceChange: 0, resourceDestroy: 0 },
                human: '',
              },
              policy: null,
              advisories: NO_AGENT,
            },
          ],
        },
        'module validate': {
          documents: [
            validation('/work/repo/infra/staging', [
              { severity: 'error', message: 'not set', file: 'main.tf', line: 4, column: 2 },
            ]),
          ],
        },
      },
      answers: {
        'Error: no_certification': clicked,
        'Validated infra/staging: lossy, 1 diagnostic.': 'Show Report',
      },
    });
    const [row] = await t.children();
    const applying = t.command(STACK_COMMANDS.apply, row);
    await settled();
    expect(t.messages).toContainEqual({
      level: 'error',
      text: 'Error: no_certification',
      buttons: ['Validate', 'Show Output'],
    });

    // While the notice is up, a stack of another root runs.
    await t.command(STACK_COMMANDS.preview, {
      kind: 'stack',
      root: prod,
      stack: stack('stk_p', 'prod'),
    });
    await settled();
    click('Validate');
    await applying;
    await settled();

    expect(t.commands.invoked.filter((c) => c.path === 'module validate')).toEqual([
      { cwd: '/work/repo/infra/staging', path: 'module validate', args: {} },
    ]);
    expect(t.messages).toContainEqual({
      level: 'warn',
      text: 'Validated infra/staging: lossy, 1 diagnostic.',
      buttons: ['Show Report'],
    });
    expect(t.log.lines).toEqual([
      'Validated infra/staging: lossy, 1 diagnostic.',
      '  /work/repo/infra/staging/main.tf:4:2: error: not set',
    ]);
  });

  test('from the palette, names the root and picks one of its stacks', async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'), stack('stk_2', 'qa'))] },
        'stack apply': { documents: [applyResult()] },
      },
      picks: ['qa'],
    });
    await t.command(STACK_COMMANDS.apply);
    await settled();
    expect(t.commands.invoked.find((c) => c.path === 'stack apply')?.args).toEqual({
      stack: 'stk_2',
    });
  });

  test('settled, ticks the canvas of the root it ran in, whatever root the tree acted on since', async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'stack apply': { held: true },
        'stack preview': {
          documents: [
            {
              stack: { id: 'stk_s', slug: 'staging' },
              treeHash: 'h1',
              plan: {
                summary: { resourceAdd: 0, resourceChange: 0, resourceDestroy: 0 },
                human: '',
              },
              policy: null,
              advisories: NO_AGENT,
            },
          ],
        },
      },
    });
    const [row] = await t.children();
    const applying = t.command(STACK_COMMANDS.apply, row);
    await settled();
    // The apply's start ticks its own root.
    expect(t.panels.tick.mock.calls).toEqual([[prod]]);

    await t.command(STACK_COMMANDS.preview, {
      kind: 'stack',
      root: staging,
      stack: stack('stk_s', 'staging'),
    });
    await settled();
    t.commands.held.find((c) => c.path === 'stack apply')?.finish([applyResult()]);
    await applying;
    await settled();

    expect(t.panels.tick.mock.calls).toEqual([[prod], [prod]]);
  });

  test('held for approval, says what it waits on and offers the page of each record, which the window opens', async () => {
    const page = 'https://acme.atlassian.net/browse/CHG-42';
    const said =
      'The change to prod awaits approval: change request chg_1, submitted. Requirement creq_policy: approved, decided in Lace. Requirement creq_jsm: pending, decided in jsm CHG-42. Record jsm CHG-42: open, awaiting its decision, https://acme.atlassian.net/browse/CHG-42.';
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'stack apply': {
          documents: [
            { type: 'phase', name: 'submit' },
            { type: 'phase', name: 'awaiting_approval' },
            {
              type: 'gate',
              resolution: { mode: 'awaiting_approval' },
              changeRequest: {
                id: 'chg_1',
                state: 'submitted',
                requirements: [
                  { id: 'creq_policy', state: 'approved', decidedBy: 'lace', recordId: null },
                  { id: 'creq_jsm', state: 'pending', decidedBy: 'ecm', recordId: 'crec_jsm' },
                ],
                records: [
                  {
                    id: 'crec_jsm',
                    externalSystemId: 'esys_jsm',
                    kind: 'jsm',
                    externalRef: 'CHG-42',
                    externalUrl: page,
                    state: 'open',
                    decision: null,
                  },
                ],
              },
            },
            { ...applyResult(), run: run('run_9', 'awaiting_approval') },
          ],
        },
      },
      answers: { [said]: 'Open jsm CHG-42' },
    });
    const [row] = await t.children();
    await t.command(STACK_COMMANDS.apply, row);
    await settled();

    expect(t.messages).toContainEqual({
      level: 'info',
      text: said,
      buttons: ['Open jsm CHG-42', 'Show Output'],
    });
    expect(t.offers.openRecord).toHaveBeenCalledWith({
      kind: 'openRecord',
      record: 'jsm CHG-42',
      url: page,
    });
    expect(t.shownChannels).toEqual([]);
  });

  test('its Cancel is the run’s explicit cancel', async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'stack apply': { held: true },
      },
    });
    const [row] = await t.children();
    const applying = t.command(STACK_COMMANDS.apply, row);
    await settled();
    t.progress.find((p) => p.title === 'Applying prod')?.cancel();
    const applyCall = t.commands.held.find((c) => c.path === 'stack apply');
    expect(applyCall?.cancelled).toBe(1);
    applyCall?.finish([], new CommandExitError(130, ''));
    await applying;
    expect(t.messages).toContainEqual({
      level: 'info',
      text: 'Cancelled the apply of prod.',
      buttons: ['Show Output'],
    });
  });
});
