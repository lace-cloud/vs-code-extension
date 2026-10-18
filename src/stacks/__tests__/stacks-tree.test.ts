import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CommandExitError,
  type CommandFailure,
  type CommandRun,
  CommandUnobservedError,
  type LaceReason,
} from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { outsideSignals } from '../../account/__tests__/fake-outside';
import { authoringCommands } from '../../commands/authoring-commands';
import { fakeCommands, refused, type Script } from '../../engine/__tests__/fake-commands';
import { createRunnerHost } from '../../engine/runner-host';
import { folder, fsPath, uri } from '../../roots/__tests__/fake-uri';
import type { AuthoringRoot, RootSources } from '../../roots/authoring-roots';
import { createRootState } from '../../state/root-state';
import { type Button, clicked, titleOf } from '../../vscode/__tests__/fake-messages';
import { fakeQuickPicks } from '../../vscode/__tests__/fake-quick-pick';
import { formAnswerer } from '../../vscode/form-answerer';
import { type OfferActions, offeringPresenter } from '../../vscode/offers';
import { createRunOutput } from '../run-output';
import { stackPick } from '../stack-pick';
import {
  PREVIEW_SCHEME,
  type Row,
  STACK_COMMANDS,
  STACKS_CHOICE,
  STACKS_STATE,
  stacksTree,
} from '../stacks-tree';
import { fakeTreeView } from './fake-tree-view';
import { memento, run, runs, stack, stacks } from './stack-fixtures';

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

// The Advisories of a preview of a stack no Agent is bound at Preview on.
const NO_AGENT = {
  queue: { manifestation: 'preview', floor: 0.5, entries: [], belowFloor: 0 },
  truncated: false,
  pending: 0,
  bound: 0,
};
// A preview of prod: one bucket to add, no policy, no Agent bound.
const PROD_PREVIEW = {
  stack: { id: 'stk_1', slug: 'prod' },
  treeHash: 'h1',
  plan: {
    summary: { resourceAdd: 1, resourceChange: 0, resourceDestroy: 0 },
    human: '+ aws_s3_bucket.b',
  },
  policy: null,
  advisories: NO_AGENT,
};
const PROD_PREVIEW_TEXT =
  'Preview of prod (tree h1)\n\n+ aws_s3_bucket.b\n\nPolicy: none applies\n\nAdvisories: no Agent is installed and bound at Preview\n';
const COMPLETED = '2026-09-01T01:00:00Z';
const applyResult = (error: string | null = null) => ({
  type: 'result',
  run: run('run_9', error ? 'apply_failed' : 'apply_succeeded', { completedAt: COMPLETED }),
  summary: { resourceAdd: 1, resourceChange: 0, resourceDestroy: 0 },
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

type Setup = ReturnType<typeof setup>;

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
    vi.fn(async (text: string, ...buttons: Button[]) => {
      messages.push({ level, text, buttons: buttons.map(titleOf) });
      return clicked(buttons, await options.answers?.[text]);
    });
  const channels = new Map<string, string[]>();
  const shownChannels: string[] = [];
  let content: vscode.TextDocumentContentProvider | undefined;
  const opened: string[] = [];
  // Each document the window shows: its URI and language, with the options
  // it is shown with.
  const shown: { document: unknown; options: unknown }[] = [];
  // Each progress the window shows: a notification's title, or the view it
  // is drawn over, and whether its task has ended.
  const progress: {
    title?: string;
    view?: string;
    reports: string[];
    cancel: () => void;
    ended: boolean;
  }[] = [];
  const activeEditor = new Emitter<unknown>();
  // A command line ending in one of the window's integrated terminals.
  const outside = outsideSignals();
  // A change of the workspace's folders, told once `folders` holds them.
  const workspaceFolders = new Emitter<vscode.WorkspaceFoldersChangeEvent>();
  const quickPicks = fakeQuickPicks<{ label: string; stack?: { slug: string }; id?: string }>(
    (items) => {
      const picked = options.picks?.shift();
      return items.find((item) => (item.stack?.slug ?? item.id) === picked);
    },
  );
  const api = {
    window: {
      createTreeView: (_id: string, { treeDataProvider }: { treeDataProvider: never }) => {
        provider = treeDataProvider;
        return view;
      },
      createQuickPick: quickPicks.createQuickPick,
      showInputBox: vi.fn(async () => options.inputs?.shift()),
      withProgress: vi.fn(
        async (
          opts: { title?: string; location: number | { viewId: string } },
          task: (p: never, t: never) => unknown,
        ) => {
          const cancelled = new Emitter<void>();
          const entry = {
            title: opts.title,
            view: typeof opts.location === 'object' ? opts.location.viewId : undefined,
            reports: [] as string[],
            cancel: () => cancelled.fire(),
            ended: false,
          };
          progress.push(entry);
          try {
            return await task(
              {
                report: ({ message }: { message: string }) => entry.reports.push(message),
              } as never,
              { onCancellationRequested: cancelled.event } as never,
            );
          } finally {
            entry.ended = true;
          }
        },
      ),
      showInformationMessage: answer('info'),
      showWarningMessage: answer('warn'),
      showErrorMessage: answer('error'),
      setStatusBarMessage: vi.fn(),
      onDidChangeActiveTextEditor: activeEditor.event,
      onDidEndTerminalShellExecution: outside.window.onDidEndTerminalShellExecution,
      showTextDocument: vi.fn(async (document: unknown, options: unknown) => {
        shown.push({ document, options });
      }),
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
        return { uri: u, languageId: 'plaintext' };
      }),
      onDidChangeWorkspaceFolders: workspaceFolders.event,
    },
    languages: {
      setTextDocumentLanguage: vi.fn(async (document: object, languageId: string) => ({
        ...document,
        languageId,
      })),
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
  // What each change of the tree's data named: the rows to redraw, or
  // `undefined` for the whole tree.
  const redrawn: (Row | Row[] | undefined)[] = [];
  provider?.onDidChangeTreeData?.((rows) => {
    redrawn.push(rows as Row | Row[] | undefined);
  });
  const item = (row: Row) => provider?.getTreeItem(row) as vscode.TreeItem;
  // The tree as VS Code holds it, over the provider the view was given.
  const shownTree = () => fakeTreeView(provider as vscode.TreeDataProvider<Row>);
  const command = (id: string, ...args: unknown[]) => handlers.get(id)?.(...args);
  return {
    api,
    commands,
    view,
    tree,
    children,
    item,
    shownTree,
    command,
    contexts,
    choices,
    messages,
    picks: quickPicks.picks,
    channels,
    shownChannels,
    opened,
    shown,
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
    terminal: outside,
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
      ['stack list', { source: fsPath('/work/repo/infra/prod') }],
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

  test('a stack expands to its recent runs, each row saying whether its run ended; a run with a page offers it', async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'run list': {
          documents: [
            runs(
              run('run_1', 'apply_succeeded', {
                completedAt: COMPLETED,
                url: 'https://portal/o/t/stacks/stk_1/runs/run_1',
              }),
              run('run_2', 'applying'),
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
        contextValue: 'laceRun ended portal',
        iconPath: { id: 'pass-filled' },
      },
      { label: 'apply · run_2', contextValue: 'laceRun running', iconPath: { id: 'sync~spin' } },
    ]);

    await t.command(STACK_COMMANDS.openInPortal, runRows[0]);
    expect(t.api.env.openExternal).toHaveBeenCalledWith({
      url: 'https://portal/o/t/stacks/stk_1/runs/run_1',
    });
  });

  test("a stack whose runs' list ended before it finished shows a row that says to list them again", async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'run list': { fails: new CommandUnobservedError('run list') },
      },
    });
    const [prodRow] = await t.children();
    const runRows = await t.children(prodRow);

    expect(runRows.map((row) => t.item(row))).toMatchObject([
      {
        label: "the engine's stream ended before `lace run list` exited; run it again",
        iconPath: { id: 'error' },
      },
    ]);
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
    await settled();
    expect(t.redrawn).toEqual([]);
    await t.command(STACK_COMMANDS.refresh);
    await settled();
    expect(t.view.description).toBe('infra/prod');
    expect(t.commands.invoked.map((c) => c.args)).toEqual([
      { source: fsPath('/work/api/infra/prod') },
      { source: fsPath('/work/api/infra/prod') },
    ]);
  });

  test('follows the canvas the developer turns to, which changes no stack and tells no canvas', async () => {
    const t = setup({ root: prod, scripts: { 'stack list': { documents: [stacks()] } } });
    await t.children();
    t.active.fire(staging);
    await settled();
    expect(t.redrawn).toEqual([undefined]);
    expect(t.panels.tick).not.toHaveBeenCalled();
    await t.children();
    expect(t.view.description).toBe('infra/staging');
    expect(t.commands.invoked.at(-1)?.args).toEqual({ source: fsPath('/work/repo/infra/staging') });
  });

  test('of two reads under way at once, the one started later is what the view holds and draws, whichever answers last', async () => {
    type Listed = ReturnType<typeof stacks>;
    const answers: ((listed: Listed) => void)[] = [];
    let lists = 0;
    const t = setup({
      root: prod,
      scripts: {
        'stack list': () =>
          lists++ === 0
            ? { documents: [stacks(stack('stk_1', 'prod'))] }
            : new Promise<Script>((resolve) => {
                answers.push((listed) => resolve({ documents: [listed] }));
              }),
      },
    });
    const tree = t.shownTree();
    await tree.show();
    void t.command(STACK_COMMANDS.refresh);
    await settled();
    void t.command(STACK_COMMANDS.refresh);
    await settled();

    const [older, later] = answers;
    later(stacks(stack('stk_3', 'later')));
    await settled();
    await tree.answered();
    older(stacks(stack('stk_2', 'older')));
    await settled();
    await tree.answered();

    const slugOf = (row: unknown) => (row as Extract<Row, { kind: 'stack' }>).stack.slug;
    expect((await t.children()).map(slugOf)).toEqual(['later']);
    expect(tree.drawn().map((handle) => slugOf(tree.argument(handle)))).toEqual(['later']);
    expect(t.redrawn).toEqual([undefined]);
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
    await settled();
    expect(t.redrawn).toEqual([undefined]);
    await t.children();
    expect(t.view.description).toBe('api/infra/prod');

    t.active.fire({ folder: web, relative: 'infra/prod' });
    await settled();
    await t.children();
    expect(t.view.description).toBe('web/infra/prod');

    folders.pop();
    t.workspaceFolders.fire({ added: [], removed: [web] });
    await settled();
    expect(t.redrawn).toEqual([undefined, undefined, undefined]);
    await t.children();
    expect(t.view.description).toBe('infra/prod');
    expect(t.commands.invoked.map((c) => c.args)).toEqual([
      { source: fsPath('/work/api/infra/prod') },
      { source: fsPath('/work/api/infra/prod') },
      { source: fsPath('/work/web/infra/prod') },
      { source: fsPath('/work/api/infra/prod') },
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
      'No folder is open. Open the folder that holds the module to see the stacks deployed from it.\n[Open Folder](command:workbench.action.files.openFolder)',
      ['workbench.action.files.openFolder'],
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
    await settled();
    expect(t.redrawn).toEqual([undefined]);
    await t.children();
    expect(t.view.description).toBe('repo');
    expect(t.commands.invoked.map((c) => [c.path, c.args])).toEqual([
      ['stack list', { source: fsPath('/work/repo') }],
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
    await rooted.command(STACK_COMMANDS.refresh);
    await settled();
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
    await one.command(STACK_COMMANDS.refresh);
    await settled();
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
      ['stack list', { source: fsPath('/work/repo/infra/new') }],
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
    expect(t.commands.invoked.at(-1)?.args).toEqual({ source: fsPath('/work/repo/infra/new') });
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
  ])('%s on a module with no stack says so and how one is created, and leaves no pick open', async (id) => {
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
    expect(t.picks).toMatchObject([{ visible: false, items: [] }]);
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

  test('a read that fails before the stacks are listed, for a root the view turned to, holds no stack of the root it left and says why', async () => {
    const t = setup({
      root: prod,
      scripts: { 'stack list': { documents: [stacks(stack('stk_1', 'prod'))] } },
    });
    expect(await t.children()).toHaveLength(1);

    t.terraformFiles.mockRejectedValueOnce(new Error('the workspace could not be searched'));
    t.active.fire(staging);
    await settled();

    expect(t.redrawn).toEqual([undefined]);
    expect(await t.children()).toEqual([]);
    expect(t.view.description).toBe('infra/staging');
    expect(t.contexts.at(-1)).toBe('failed');
    expect(t.view.message).toBe('the workspace could not be searched');
  });

  test('any other failure says its message, and is read again after a change of account', async () => {
    const t = await stateFor({ 'stack list': refusal('unspecified') });
    expect(t.contexts).toEqual(['failed']);
    expect(t.view.message).toBe('unspecified');

    t.account.fire();
    await settled();
    expect(t.redrawn).toEqual([undefined]);
    expect(t.commands.paths().filter((path) => path === 'stack list')).toHaveLength(2);
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
        cwd: fsPath('/work/repo/infra/prod'),
        path: 'stack create',
        args: { source: fsPath('/work/repo/infra/prod'), slug: 'prod', connection: 'conn_1' },
      },
    ]);
    // The view's own progress, drawn while the store marks a command running, has no title.
    expect(t.progress.flatMap((p) => p.title ?? [])).toEqual(['Create stack: infra/prod']);
    expect(done).toBe(false);

    created = true;
    t.commands.held[0].finish([stack('stk_9', 'prod')]);
    await creating;
    await settled();
    expect(t.messages).toContainEqual({ level: 'info', text: 'Created stack prod', buttons: [] });
    expect(t.redrawn).toContain(undefined);
    const [row] = await t.children();
    expect(row).toMatchObject({ kind: 'stack', stack: { slug: 'prod' } });
    expect(t.panels.tick).toHaveBeenCalledWith(prod);
  });

  test("a refusal of stack create says its failure document's message", async () => {
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
      text: 'not_git_repository',
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

  test('selected, redraws the row picked before and the row picked now, the rows the tree gave, never the whole tree', async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'), stack('stk_2', 'qa'))] },
      },
    });
    const [prodRow, qaRow] = await t.children();

    t.view.selection.fire({ selection: [prodRow] });
    await settled();
    t.view.selection.fire({ selection: [qaRow] });
    await settled();

    expect(t.redrawn).toHaveLength(2);
    const [first, second] = t.redrawn as Row[][];
    expect(first).toHaveLength(1);
    expect(first[0]).toBe(prodRow);
    expect(second).toHaveLength(2);
    expect(second[0]).toBe(prodRow);
    expect(second[1]).toBe(qaRow);
    expect(t.item(prodRow).description).toBe('prod');
    expect(t.item(qaRow).description).toBe('qa · on the canvas');
  });

  // What may have changed the stacks of the view's root: the tree reads them
  // again, and the root's canvas, whose badges read the same facts, is told
  // its reads are stale, once.
  test.each([
    ['Refresh Stacks', (t: Setup) => t.command(STACK_COMMANDS.refresh)],
    ['the view shown again', (t: Setup) => t.view.visibility.fire({ visible: true })],
    ['a change of the account', (t: Setup) => t.account.fire()],
    [
      'a lace command that may change a stack, ended in an integrated terminal',
      (t: Setup) => t.terminal.ended('lace stack destroy prod --yes'),
    ],
  ])("%s reads the whole tree again and tells the root's canvas once", async (_, change) => {
    const t = setup({ root: prod, scripts: { ...listed } });
    await t.children();
    await change(t);
    await settled();
    expect(t.redrawn).toEqual([undefined]);
    expect(t.commands.paths().filter((path) => path === 'stack list')).toHaveLength(2);
    expect(t.panels.tick.mock.calls).toEqual([[prod]]);
  });

  test('the view hidden, and a command line that changes no stack, read nothing and tell no canvas', async () => {
    const t = setup({ root: prod, scripts: { ...listed } });
    await t.children();
    t.view.visibility.fire({ visible: false });
    t.terminal.ended('lace stack list --source infra/prod');
    t.terminal.ended('lace -o json run get run_1');
    t.terminal.ended('echo lace stack destroy prod');
    t.terminal.ended('lace engine');
    await settled();
    expect(t.redrawn).toEqual([]);
    expect(t.panels.tick).not.toHaveBeenCalled();
  });

  test.each([
    STACK_COMMANDS.followLogs,
    STACK_COMMANDS.cancel,
    STACK_COMMANDS.openInPortal,
  ])('%s invoked with no run row says it acts on a run of the Stacks view, and runs nothing', async (id) => {
    const t = setup({ root: prod, scripts: { ...listed } });
    await t.command(id);
    await settled();
    expect(t.messages).toEqual([
      {
        level: 'info',
        text: "This command acts on a run listed in the Stacks view; choose it from that run's menu.",
        buttons: [],
      },
    ]);
    expect(t.commands.invoked).toEqual([]);
    expect(t.api.env.openExternal).not.toHaveBeenCalled();
  });

  test("a Preview refused for no certification offers Validate on the run's root, which validates that root", async () => {
    const t = setup({
      root: prod,
      scripts: {
        ...listed,
        'stack preview': refusal('no_certification'),
        'module validate': { documents: [validation('/work/repo/infra/prod', [])] },
      },
      answers: { no_certification: 'Validate' },
    });
    const [row] = await t.children();
    await t.command(STACK_COMMANDS.preview, row);
    await settled();
    await settled();

    expect(t.messages[0]).toEqual({
      level: 'error',
      text: 'no_certification',
      buttons: ['Validate'],
    });
    expect(t.commands.invoked.find((c) => c.path === 'module validate')?.cwd).toBe(
      fsPath('/work/repo/infra/prod'),
    );
  });

  test("runs the package's bindings over the root and the stack: Preview, Scan, Follow logs, Cancel", async () => {
    const t = setup({
      root: prod,
      scripts: {
        ...listed,
        'run list': { documents: [runs(run('run_1', 'applying'))] },
        'stack preview': { documents: [PROD_PREVIEW] },
        'stack scan': { documents: [{ triggered: true, reason: null, settled: null }] },
        'run logs': {
          documents: [
            { type: 'log', text: 'line one' },
            { type: 'result', status: 'apply_succeeded' },
          ],
        },
        'run cancel': { documents: [run('run_1', 'cancelled', { completedAt: COMPLETED })] },
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
    expect(ran.find((c) => c.path === 'stack preview')?.cwd).toBe(fsPath('/work/repo/infra/prod'));
    expect(t.opened).toEqual([PROD_PREVIEW_TEXT]);
    expect(t.channels.get('Lace: prod')).toEqual(['── lace run logs run_1 ──', 'line one']);
    expect(t.shownChannels).toContain('Lace: prod');
  });

  test('its Preview opens as a document of its own in the Lace plan language, which wraps its lines', async () => {
    const t = setup({
      root: prod,
      scripts: { ...listed, 'stack preview': { documents: [PROD_PREVIEW] } },
    });
    const [row] = await t.children();

    await t.command(STACK_COMMANDS.preview, row);
    await settled();

    expect(t.shown).toEqual([
      {
        document: {
          uri: { scheme: PREVIEW_SCHEME, path: '/prod-1.plan' },
          languageId: 'lace-plan',
        },
        options: { preview: false },
      },
    ]);
  });
});

describe('Cancel on a run row', () => {
  const listed = {
    'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
    'run list': { documents: [runs(run('run_1', 'applying'))] },
  };
  // The titled progress notifications the window showed: the view's own
  // progress has no title.
  const notifications = (t: ReturnType<typeof setup>) =>
    t.progress.filter((p) => p.title !== undefined).map(({ title, ended }) => ({ title, ended }));

  test("runs the package's run cancel under a progress notification titled by the run until its run ends, and ends with the package's notice", async () => {
    const t = setup({ root: prod, scripts: { ...listed, 'run cancel': { held: true } } });
    const [row] = await t.children();
    const [runRow] = await t.children(row);
    let done = false;
    const cancelling = t.command(STACK_COMMANDS.cancel, runRow)?.then(() => {
      done = true;
    });
    await settled();

    expect(t.commands.invoked.filter((c) => c.path === 'run cancel').map((c) => c.args)).toEqual([
      { run: 'run_1' },
    ]);
    expect(notifications(t)).toEqual([{ title: 'Cancel: run_1', ended: false }]);
    expect(done).toBe(false);

    t.commands.held[0].finish([run('run_1', 'cancelled', { completedAt: COMPLETED })]);
    await cancelling;
    expect(notifications(t)).toEqual([{ title: 'Cancel: run_1', ended: true }]);
    expect(t.messages).toEqual([{ level: 'info', text: 'Run run_1 cancelled', buttons: [] }]);
  });

  // A run row drawn under its stack, whose stack's runs are listed again
  // only once the test says: the first `run list` answers at once, every
  // later one when `release` is called.
  function drawnRun(scripts: Parameters<typeof setup>[0]['scripts'] = {}) {
    let release: () => void = () => {};
    const later = new Promise<Script>((resolve) => {
      release = () => resolve({ documents: [runs(run('run_1', 'applying'))] });
    });
    let lists = 0;
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'run list': () =>
          lists++ === 0 ? { documents: [runs(run('run_1', 'policy_eval'))] } : later,
        'run cancel': { documents: [run('run_1', 'cancelled', { completedAt: COMPLETED })] },
        ...scripts,
      },
    });
    const tree = t.shownTree();
    return { t, tree, release: () => release() };
  }
  const NO_RUN =
    "This command acts on a run listed in the Stacks view; choose it from that run's menu.";

  test("chosen from a run row's menu while an apply of its stack ticks the store, reaches that run and cancels it; the row is redrawn once its stack's runs are read", async () => {
    const { t, tree, release } = drawnRun({
      'stack apply': { held: true, written: [{ type: 'stage', name: 'plan' }] },
    });
    await tree.show();
    const [stackHandle] = tree.drawn();
    await tree.expand(stackHandle);
    const [runHandle] = tree.drawn(stackHandle);

    void t.command(STACK_COMMANDS.apply, tree.argument(stackHandle));
    await settled();
    await t.command(STACK_COMMANDS.cancel, tree.argument(runHandle));
    await settled();

    expect(t.messages.map(({ text }) => text)).not.toContain(NO_RUN);
    expect(t.commands.invoked.filter((c) => c.path === 'run cancel').map((c) => c.args)).toEqual([
      { run: 'run_1' },
    ]);

    release();
    await settled();
    await tree.answered();
    expect(tree.drawn(stackHandle)).toEqual([runHandle]);
    expect(t.item(tree.argument(stackHandle) as Row).description).toBe('prod · applying: plan');
  });

  test("chosen from a run row's menu while the view reads the whole tree again, reaches that run and cancels it", async () => {
    const { t, tree, release } = drawnRun();
    await tree.show();
    const [stackHandle] = tree.drawn();
    await tree.expand(stackHandle);
    const [runHandle] = tree.drawn(stackHandle);

    void t.command(STACK_COMMANDS.refresh);
    await settled();
    await t.command(STACK_COMMANDS.cancel, tree.argument(runHandle));
    await settled();

    expect(t.messages.map(({ text }) => text)).not.toContain(NO_RUN);
    expect(t.commands.invoked.filter((c) => c.path === 'run cancel').map((c) => c.args)).toEqual([
      { run: 'run_1' },
    ]);

    release();
    await settled();
    await tree.answered();
    expect(tree.drawn(stackHandle)).toEqual([runHandle]);
    expect(t.item(tree.argument(runHandle) as Row).description).toMatch(/^applying /);
  });

  test("a cancel the CLI refuses ends its progress with the failure document's message", async () => {
    const said = 'run run_1 cannot be cancelled in its current state';
    const t = setup({
      root: prod,
      scripts: { ...listed, 'run cancel': refused({ reason: 'unspecified', message: said }) },
    });
    const [row] = await t.children();
    const [runRow] = await t.children(row);
    await t.command(STACK_COMMANDS.cancel, runRow);
    await settled();

    expect(notifications(t)).toEqual([{ title: 'Cancel: run_1', ended: true }]);
    expect(t.messages).toEqual([{ level: 'error', text: said, buttons: [] }]);
  });
});

describe('an apply', () => {
  const lines = [
    { type: 'log', text: 'Preview Advisory:' },
    { type: 'log', text: '  + aws_s3_bucket.b' },
    { type: 'log', text: '' },
    { type: 'stage', name: 'plan' },
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
    expect(t.ran.every((made) => made.ctx.root === fsPath('/work/repo/infra/prod'))).toBe(true);
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

  test('settled, writes to the stack’s Output channel each provider version its Run ran under an admission, as lace run get prints them', async () => {
    const admitted = {
      ...applyResult(),
      run: {
        ...applyResult().run,
        providers: [
          { address: 'registry.terraform.io/hashicorp/aws', version: '5.0.0' },
          {
            address: 'registry.terraform.io/hashicorp/random',
            version: '3.7.1',
            admission: {
              id: 'adm_1',
              admittedBy: 'usr_1',
              admittedByName: 'Dev Lead',
              admittedAt: '2026-10-16T09:00:00Z',
            },
          },
          {
            address: 'registry.terraform.io/hashicorp/null',
            version: '3.2.4',
            admission: {
              id: 'adm_2',
              admittedBy: 'usr_2',
              admittedByName: null,
              admittedAt: '2026-10-17T10:00:00Z',
            },
          },
        ],
      },
    };
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'stack apply': { documents: [...lines, admitted] },
      },
    });
    const [row] = await t.children();
    await t.command(STACK_COMMANDS.apply, row);
    await settled();

    expect(t.channels.get('Lace: prod')?.slice(-2)).toEqual([
      'Admitted:   registry.terraform.io/hashicorp/random 3.7.1 (admitted by Dev Lead, 2026-10-16T09:00:00Z)',
      'Admitted:   registry.terraform.io/hashicorp/null 3.2.4 (admitted by usr_2, 2026-10-17T10:00:00Z)',
    ]);
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
        no_certification: clicked,
        'Validated infra/staging: lossy, 1 diagnostic.': 'Show Report',
      },
    });
    const [row] = await t.children();
    const applying = t.command(STACK_COMMANDS.apply, row);
    await settled();
    expect(t.messages).toContainEqual({
      level: 'error',
      text: 'no_certification',
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
      { cwd: fsPath('/work/repo/infra/staging'), path: 'module validate', args: {} },
    ]);
    expect(t.messages).toContainEqual({
      level: 'warn',
      text: 'Validated infra/staging: lossy, 1 diagnostic.',
      buttons: ['Show Report'],
    });
    expect(t.log.lines).toEqual([
      'Validated infra/staging: lossy, 1 diagnostic.',
      `  ${fsPath('/work/repo/infra/staging/main.tf')}:4:2: error: not set`,
    ]);
  });

  test("refused for keeping no lockfile offers the package's Lock providers, which runs module lock in the apply's root under a progress notification and says what it locked", async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'stack apply': refusal('no_lockfile'),
        'module lock': {
          documents: [
            // The CLI writes the paths of its JSON with '/' on every system.
            {
              path: '/work/repo/infra/prod',
              lockfile: '/work/repo/infra/prod/.terraform.lock.hcl',
              providers: [
                {
                  address: 'registry.terraform.io/hashicorp/aws',
                  version: '5.0.0',
                  platforms: ['linux_amd64'],
                },
              ],
            },
          ],
        },
      },
      answers: { no_lockfile: 'Lock providers' },
    });
    const [row] = await t.children();
    await t.command(STACK_COMMANDS.apply, row);
    await settled();
    await settled();

    expect(t.messages).toContainEqual({
      level: 'error',
      text: 'no_lockfile',
      buttons: ['Lock providers', 'Show Output'],
    });
    expect(t.commands.invoked.filter((c) => c.path === 'module lock')).toEqual([
      { cwd: fsPath('/work/repo/infra/prod'), path: 'module lock', args: {} },
    ]);
    expect(t.progress.find((p) => p.title === 'Lock providers: prod')).toMatchObject({
      ended: true,
    });
    expect(t.messages).toContainEqual({
      level: 'info',
      text: 'Locked 1 provider in .terraform.lock.hcl. Commit it beside the tree. Then run the refused command again.',
      buttons: [],
    });
  });

  test('cancelled by someone else while it ran, settles calm: the notice says the apply was cancelled, and nothing is an error', async () => {
    const t = setup({
      root: prod,
      scripts: {
        'stack list': { documents: [stacks(stack('stk_1', 'prod'))] },
        'stack apply': {
          documents: [
            { type: 'stage', name: 'runner' },
            {
              ...applyResult('run_cancelled'),
              run: run('run_9', 'cancelled', { completedAt: COMPLETED }),
            },
          ],
          fails: new CommandExitError(1, 'Source: /work/repo/infra/prod\nRun cancelled.\n'),
        },
      },
    });
    const [row] = await t.children();
    await t.command(STACK_COMMANDS.apply, row);
    await settled();

    expect(t.messages).toContainEqual({
      level: 'info',
      text: 'Cancelled the apply of prod.',
      buttons: ['Show Output'],
    });
    expect(t.messages.filter(({ level }) => level === 'error')).toEqual([]);
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

  test("settled while the view names another root, reads the tree again and tells the view's canvas and its own once each", async () => {
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
    expect(t.panels.tick.mock.calls).toEqual([[prod]]);

    t.active.fire(staging);
    await t.children();
    t.commands.held.find((c) => c.path === 'stack apply')?.finish([applyResult()]);
    await applying;
    await settled();

    expect(t.panels.tick.mock.calls).toEqual([[prod], [staging], [prod]]);
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
            { type: 'stage', name: 'submit' },
            { type: 'stage', name: 'awaiting_approval' },
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

describe("the view's progress", () => {
  const listed = { 'stack list': { documents: [stacks(stack('stk_1', 'prod'))] } };
  const overView = (t: ReturnType<typeof setup>) =>
    t.progress.filter((p) => p.view === 'laceStacks').map(({ ended }) => ({ ended }));

  test("is drawn from the store's running mark, from the moment it is set until it is cleared", async () => {
    const t = setup({ root: prod, scripts: { ...listed } });
    await t.children();
    const token = {};
    t.runner.store.begin(
      'notify',
      token,
      { stack: 'stk_1' },
      { target: {}, on: 'stack:stk_1', path: 'stack scan', label: 'Scan for drift' },
    );
    await settled();
    expect(overView(t)).toEqual([{ ended: false }]);

    t.runner.store.detach('notify', token);
    await settled();
    expect(overView(t)).toEqual([{ ended: true }]);
  });

  test('is drawn while a scan of a stack runs, and ends when it ends, however it ends', async () => {
    const t = setup({ root: prod, scripts: { ...listed, 'stack scan': { held: true } } });
    const [row] = await t.children();

    await t.command(STACK_COMMANDS.scan, row);
    await settled();
    expect(overView(t)).toEqual([{ ended: false }]);

    t.commands.held[0].finish([], new CommandExitError(1, 'Error: no\n'));
    await settled();
    expect(overView(t)).toEqual([{ ended: true }]);
  });

  test('is drawn while a preview runs, and ends when its plan lands, which opens then', async () => {
    const t = setup({ root: prod, scripts: { ...listed, 'stack preview': { held: true } } });
    const [row] = await t.children();

    await t.command(STACK_COMMANDS.preview, row);
    await settled();
    expect(overView(t)).toEqual([{ ended: false }]);
    expect(t.opened).toEqual([]);

    t.commands.held[0].finish([PROD_PREVIEW]);
    await settled();
    expect(overView(t)).toEqual([{ ended: true }]);
    expect(t.opened).toEqual([PROD_PREVIEW_TEXT]);
  });

  test('ends when a preview fails, which opens nothing', async () => {
    const t = setup({ root: prod, scripts: { ...listed, 'stack preview': { held: true } } });
    const [row] = await t.children();

    await t.command(STACK_COMMANDS.preview, row);
    await settled();
    t.commands.held[0].finish([], new CommandExitError(1, 'Error: no\n'));
    await settled();
    expect(overView(t)).toEqual([{ ended: true }]);
    expect(t.opened).toEqual([]);
  });

  // A follow is a subscription to a run's logs, not a command under way.
  test("is not drawn while a run's logs are followed", async () => {
    const t = setup({
      root: prod,
      scripts: {
        ...listed,
        'run list': { documents: [runs(run('run_1', 'applying'))] },
        'run logs': { held: true },
      },
    });
    const [row] = await t.children();
    const [runRow] = await t.children(row);

    await t.command(STACK_COMMANDS.followLogs, runRow);
    await settled();
    expect(overView(t)).toEqual([]);
  });

  test('is drawn while an apply runs, and ends when its run settles', async () => {
    const t = setup({ root: prod, scripts: { ...listed, 'stack apply': { held: true } } });
    const [row] = await t.children();

    const applying = t.command(STACK_COMMANDS.apply, row);
    await settled();
    expect(overView(t)).toEqual([{ ended: false }]);

    t.commands.held[0].finish([applyResult()]);
    await applying;
    await settled();
    expect(overView(t)).toEqual([{ ended: true }]);
  });
});
