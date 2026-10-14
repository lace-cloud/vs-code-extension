// The Stacks tree: the stacks deployed from the current authoring root
// (`lace stack list --source <root>`), each with its recent runs (`lace run
// list --stack`). The view's description names the root; it follows the
// canvas or the Terraform file the developer turns to, and its title action,
// there while more than one root is a candidate (the context key
// `lace.stacks.choice`, set each time the tree is read), is the pick Open
// Canvas uses.
//
// A row's actions are the package's bindings — Preview, Apply and Scan for
// drift on a stack, Follow logs and Cancel on a run — each run through the
// window's runner over a `RunCtx` naming the root and the stack; the tree
// restates no argument and no confirmation. The tree opens no session: the
// commands run on the Terraform on disk. Open in portal opens the page the
// CLI gave the run.
//
// A stack is created in a terminal, as one-time setup: with no stack
// deployed from the root, the view's action types the complete `lace stack
// create` line into a terminal at the root, unsent, with a placeholder for
// each argument the command requires, for the developer to fill in and run.
// The line calls the CLI as the terminal's shell calls a program by its
// path (`shellLine`, over the shell `env.shell` names).
//
// Selecting a stack picks it for the root, and the root's canvas draws its
// badges. An apply runs under a progress notification and says how it
// settled, with the ways out its failure names (Validate is the palette's,
// on the root the apply ran in); a preview opens as a
// read-only document; each tick of the runner's store (a run started or
// settled, a scan or a cancel done) reads the tree again and tells the
// canvas of the root that run was about that its reads are stale.
//
// With no root found, the view says why, by the reason finding one gave: no
// folder is open; no directory holds a module yet, and Open Canvas starts
// one; or several do, and Choose Module picks one. When the stacks cannot be
// listed, the view says why by the failure's reason, with the one action
// that gets past it.
import {
  type ActionContribution,
  CORE_COMMAND_ACTIONS,
  type CommandFailure,
  type RunCtx,
  type StackRef,
} from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import type { Account } from '../account/account';
import type { CanvasPanels } from '../canvas/canvas-panels';
import { commandDocument, failureOf, failureText } from '../engine/command-outcome';
import type { CommandsMapping } from '../engine/commands-mapping';
import type { RunnerHost } from '../engine/runner-host';
import {
  type AuthoringRoot,
  candidates,
  findRoot,
  type RootSources,
  rootAt,
  rootLabel,
  rootOfPath,
  rootPath,
  rootToAct,
  rootUri,
  sameRoot,
} from '../roots/authoring-roots';
import type { RootState } from '../state/root-state';
import { registerCommands } from '../vscode/commands';
import { notice, type OfferActions } from '../vscode/offers';
import { shellLine } from '../vscode/shell-line';
import type { RunOutput } from './run-output';
import {
  outcomeNotice,
  previewText,
  type RowLook,
  type Run,
  refusedState,
  rootlessState,
  runLook,
  type Stack,
  type StacksState,
  stackLook,
  stackRef,
} from './stack-rows';

export const STACKS_VIEW = 'laceStacks';
export const STACKS_STATE = 'lace.stacks.state';
export const STACKS_CHOICE = 'lace.stacks.choice';
export const PREVIEW_SCHEME = 'lace-preview';

export const STACK_COMMANDS = {
  refresh: 'lace.refreshStacks',
  chooseModule: 'lace.stacks.chooseModule',
  preview: 'lace.previewStack',
  apply: 'lace.applyStack',
  scan: 'lace.scanStack',
  followLogs: 'lace.followRunLogs',
  cancel: 'lace.cancelRun',
  openInPortal: 'lace.openRunInPortal',
  openPortal: 'lace.stacks.openPortal',
  createInTerminal: 'lace.stacks.createInTerminal',
} as const;

// What the terminal is given after the CLI's path: `stack create` with a
// placeholder for each argument it requires, in the root (`--source .`).
const CREATE_LINE = 'stack create SLUG --source . --connection CONNECTION_ID';

// How many of a stack's runs its row lists.
const RECENT_RUNS = 10;
const SHOW_OUTPUT = 'Show Output';

export type Row =
  | { kind: 'stack'; root: AuthoringRoot; stack: Stack }
  | { kind: 'run'; root: AuthoringRoot; stack: StackRef; run: Run }
  | { kind: 'note'; text: string; icon: string };

export type StacksTreeApi = {
  window: Pick<
    typeof vscode.window,
    | 'createTreeView'
    | 'showQuickPick'
    | 'withProgress'
    | 'showInformationMessage'
    | 'showWarningMessage'
    | 'showErrorMessage'
    | 'onDidChangeActiveTextEditor'
    | 'createTerminal'
    | 'showTextDocument'
  >;
  workspace: Pick<
    typeof vscode.workspace,
    'registerTextDocumentContentProvider' | 'openTextDocument'
  >;
  commands: Pick<typeof vscode.commands, 'registerCommand' | 'executeCommand'>;
  env: Pick<typeof vscode.env, 'shell'> & {
    openExternal: (uri: vscode.Uri) => Thenable<boolean>;
  };
  Uri: Pick<typeof vscode.Uri, 'parse' | 'from'>;
  EventEmitter: typeof vscode.EventEmitter;
  ThemeIcon: typeof vscode.ThemeIcon;
  TreeItemCollapsibleState: typeof vscode.TreeItemCollapsibleState;
  ProgressLocation: typeof vscode.ProgressLocation;
};

export type StacksTreeOptions = {
  api: StacksTreeApi;
  commands: CommandsMapping;
  runner: RunnerHost;
  runOutput: RunOutput;
  account: Pick<Account, 'onDidChange'>;
  offers: OfferActions;
  rootState: RootState;
  panels: Pick<CanvasPanels, 'tick' | 'onDidChangeActive'>;
  sources: RootSources;
  // Lace: Validate Module on a root: what an apply's notice offers.
  validate: (root: AuthoringRoot) => Promise<void>;
  // The Lace CLI the engine runs, as a terminal would name it.
  binaryPath: () => string;
  report: (what: string, error: unknown) => void;
};

const binding = (id: string): ActionContribution => {
  const found = CORE_COMMAND_ACTIONS.find((action) => action.id === id);
  if (!found) throw new Error(`the canvas package carries no binding ${id}`);
  return found;
};

export function stacksTree(options: StacksTreeOptions): vscode.Disposable {
  const { api, commands, runner, runOutput, rootState, panels, sources, report } = options;
  const BINDINGS = {
    preview: binding('preview'),
    apply: binding('apply'),
    scan: binding('scan'),
    followLogs: binding('follow-logs'),
    cancel: binding('run-cancel'),
  };

  let root: AuthoringRoot | undefined;
  // The stack rows shown, by stack id: the row an apply's progress redraws.
  let shown = new Map<string, Row>();
  // The refusal the view shows, kept for the welcome's action.
  let refusal: CommandFailure | undefined;

  const changed = new api.EventEmitter<Row | undefined>();
  const refresh = () => changed.fire(undefined);

  const rootKey = (of: AuthoringRoot) => rootUri(of).toString();

  function setState(state: StacksState, message?: string): void {
    void api.commands.executeCommand('setContext', STACKS_STATE, state);
    view.message = message;
  }

  // The root the developer picks among the workspace's modules.
  const picking: RootSources = {
    ...sources,
    activeCanvas: () => undefined,
    activeTerraformDirectory: () => undefined,
  };

  async function stackRows(of: AuthoringRoot): Promise<Row[]> {
    let stacks: Stack[];
    try {
      const listed = await commandDocument(await commands.anywhere(), 'stack list', {
        source: rootPath(of),
      });
      stacks = listed.items;
    } catch (error) {
      refusal = failureOf(error);
      shown = new Map();
      const state = refusedState(refusal);
      setState(
        state === 'noTeam' ? await teamState() : state,
        state === 'failed' ? failureText(error) : undefined,
      );
      return [];
    }
    refusal = undefined;
    setState(stacks.length === 0 ? 'noStack' : 'stacks');
    const rows: Row[] = stacks.map((stack) => ({ kind: 'stack', root: of, stack }));
    shown = new Map(stacks.map((stack, at) => [stack.id, rows[at]]));
    return rows;
  }

  // No team is selected: there is one to select, or the organization has
  // none and the portal makes one.
  async function teamState(): Promise<StacksState> {
    try {
      const teams = await commandDocument(await commands.anywhere(), 'team list', {});
      return teams.items.length === 0 ? 'teamlessOrganization' : 'noTeam';
    } catch (error) {
      report('listing the teams of the organization', error);
      return 'noTeam';
    }
  }

  async function runRows(row: Extract<Row, { kind: 'stack' }>): Promise<Row[]> {
    try {
      const listed = await commandDocument(await commands.anywhere(), 'run list', {
        stack: row.stack.id,
        limit: RECENT_RUNS,
      });
      if (listed.items.length === 0) return [{ kind: 'note', text: 'No runs yet', icon: 'info' }];
      return listed.items.map((run) => ({
        kind: 'run',
        root: row.root,
        stack: stackRef(row.stack),
        run,
      }));
    } catch (error) {
      return [{ kind: 'note', text: failureText(error), icon: 'error' }];
    }
  }

  const look = (row: Row): RowLook => {
    if (row.kind === 'stack') {
      const picked = rootState.stack(row.root)?.id === row.stack.id;
      const { run } = runner.store.getSnapshot();
      const ours = run?.readOver.stack === row.stack.id ? run : null;
      return stackLook(row.stack, picked, ours);
    }
    if (row.kind === 'run') return runLook(row.run);
    return {
      label: row.text,
      description: '',
      tooltip: row.text,
      icon: row.icon,
      contextValue: '',
    };
  };

  // A row's identity across reads, so an expanded stack stays expanded.
  const idOf = (row: Row): string | undefined =>
    row.kind === 'stack'
      ? `stack ${rootKey(row.root)} ${row.stack.id}`
      : row.kind === 'run'
        ? `run ${row.stack.id} ${row.run.id}`
        : undefined;

  const provider: vscode.TreeDataProvider<Row> = {
    onDidChangeTreeData: changed.event,
    getTreeItem(row) {
      const { label, description, tooltip, icon, contextValue } = look(row);
      return {
        id: idOf(row),
        label,
        description,
        tooltip,
        contextValue,
        iconPath: new api.ThemeIcon(icon),
        collapsibleState:
          row.kind === 'stack'
            ? api.TreeItemCollapsibleState.Collapsed
            : api.TreeItemCollapsibleState.None,
      };
    },
    async getChildren(row) {
      if (row?.kind === 'stack') return runRows(row);
      if (row) return [];
      const choice = (await candidates(sources)).length > 1;
      void api.commands.executeCommand('setContext', STACKS_CHOICE, choice);
      if (!root) {
        const found = await findRoot(sources);
        if (found.kind !== 'root') {
          view.description = undefined;
          setState(rootlessState(found));
          return [];
        }
        root = found.root;
      }
      view.description = rootLabel(root);
      return stackRows(root);
    },
  };

  const view = api.window.createTreeView(STACKS_VIEW, { treeDataProvider: provider });

  function show(next: AuthoringRoot): void {
    if (root && sameRoot(root, next)) return;
    root = next;
    refresh();
  }

  // Runs a stack row's binding over the root and the stack.
  async function runOnStack(
    action: ActionContribution,
    of: AuthoringRoot,
    stack: StackRef,
  ): Promise<void> {
    await runner.run(action, { root: rootPath(of), stack });
  }

  // An apply: under a progress notification until the run slot settles,
  // then what it settled as, with Show Output and the ways out its failure
  // names. Cancel is the run's explicit cancel.
  async function apply(of: AuthoringRoot, stack: StackRef): Promise<void> {
    const before = runner.store.getSnapshot().run?.token;
    await runOnStack(BINDINGS.apply, of, stack);
    const started = runner.store.getSnapshot().run;
    // The runner refused it (another run is under way) or did not start it.
    if (!started || started.token === before) return;
    const settled = await api.window.withProgress(
      {
        location: api.ProgressLocation.Notification,
        title: `Applying ${stack.slug}`,
        cancellable: true,
      },
      (progress, token) =>
        new Promise<NonNullable<typeof started>>((resolve) => {
          token.onCancellationRequested(() => void runner.cancel('run'));
          const check = () => {
            const slot = runner.store.getSnapshot().run;
            if (!slot || slot.token !== started.token) return;
            if (slot.outcome.kind !== 'running') {
              unsubscribe();
              resolve(slot);
              return;
            }
            const phase = slot.phases.at(-1)?.name;
            if (phase !== undefined) progress.report({ message: phase });
          };
          const unsubscribe = runner.store.subscribe(check);
          check();
        }),
    );
    if (settled.outcome.kind === 'running') return;
    const said = outcomeNotice(stack.slug, settled.outcome);
    const offers = { ...options.offers, validate: () => options.validate(of) };
    const answer = await notice(api, offers, said.level, said.text, said.failure, [SHOW_OUTPUT]);
    if (answer === SHOW_OUTPUT) runOutput.show(stack.slug);
  }

  // A stack row, or, from the palette, a stack of the root the developer
  // names to `verb` a stack of, picked from its stacks. A root not named is
  // said as `rootToAct` says it; a root with no stack says so, and how one
  // is created.
  async function stackOf(
    row: Extract<Row, { kind: 'stack' }> | undefined,
    verb: string,
  ): Promise<{ of: AuthoringRoot; stack: StackRef } | undefined> {
    if (row) return { of: row.root, stack: stackRef(row.stack) };
    const of = await rootToAct(sources, api.window, `${verb} a stack of`);
    if (!of) return undefined;
    const listed = await commandDocument(await commands.anywhere(), 'stack list', {
      source: rootPath(of),
    });
    if (listed.items.length === 0) {
      void api.window.showInformationMessage(
        `No stack is deployed from ${rootLabel(of)} yet. A stack is created once, in a terminal: Create Stack in Terminal in the Stacks view types the command.`,
      );
      return undefined;
    }
    const picked = rootState.stack(of)?.id;
    const chosen = await api.window.showQuickPick(
      listed.items.map((stack) => ({
        label: stack.name,
        description: stack.id === picked ? `${stack.slug} · on the canvas` : stack.slug,
        stack,
      })),
      { placeHolder: `A stack deployed from ${rootLabel(of)}` },
    );
    return chosen && { of, stack: stackRef(chosen.stack) };
  }

  const onStack =
    (verb: string, act: (of: AuthoringRoot, stack: StackRef) => Promise<void>) =>
    async (row?: Extract<Row, { kind: 'stack' }>) => {
      const chosen = await stackOf(row, verb);
      if (chosen) await act(chosen.of, chosen.stack);
    };

  const onRun =
    (act: (row: Extract<Row, { kind: 'run' }>) => Promise<unknown>) =>
    async (row: Extract<Row, { kind: 'run' }>) => {
      await act(row);
    };

  // Previews open as read-only documents, one per preview.
  const previews = new Map<string, string>();
  let previewCount = 0;
  const previewProvider = api.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
    provideTextDocumentContent: (uri) => previews.get(uri.path) ?? '',
  });

  // What the runner's store says, as it says it: a new preview opens; a run
  // redraws its stack's row; each tick reads the tree again and tells the
  // canvas of the root the ticking run was about.
  let shownPreview: object | undefined;
  const offStore = runner.store.subscribe(() => {
    const { preview, run } = runner.store.getSnapshot();
    const running = shown.get(run?.readOver.stack ?? '');
    if (running) changed.fire(running);
    if (preview && preview.token !== shownPreview) {
      shownPreview = preview.token;
      previewCount += 1;
      const path = `/${preview.data.stack.slug}-${previewCount}.plan`;
      previews.set(path, previewText(preview.data));
      void api.workspace
        .openTextDocument(api.Uri.from({ scheme: PREVIEW_SCHEME, path }))
        .then((document) => api.window.showTextDocument(document, { preview: false }))
        .then(undefined, (error) => report('opening a stack preview', error));
    }
  });
  const offTick = runner.onDidTick((ctx) => {
    refresh();
    const ran = ctx.root === undefined ? undefined : rootOfPath(sources.folders(), ctx.root);
    if (ran) panels.tick(ran);
  });

  const offBusy = runner.onDidChangeBusy((busy) => {
    if (!busy) return;
    void api.window.withProgress(
      { location: { viewId: STACKS_VIEW } },
      () =>
        new Promise<void>((resolve) => {
          const off = runner.onDidChangeBusy((still) => {
            if (still) return;
            off();
            resolve();
          });
        }),
    );
  });

  const subscriptions: vscode.Disposable[] = [
    view,
    changed,
    previewProvider,
    view.onDidChangeSelection(({ selection: [row] }) => {
      if (row?.kind !== 'stack') return;
      rootState
        .pickStack(row.root, stackRef(row.stack))
        .then(refresh, (error) => report('picking a stack', error));
    }),
    view.onDidChangeVisibility(({ visible }) => {
      if (visible) refresh();
    }),
    api.window.onDidChangeActiveTextEditor(() => {
      const directory = sources.activeTerraformDirectory();
      const of = directory && rootAt(sources.folders(), directory);
      if (of) show(of);
    }),
    ...registerCommands(api, {
      [STACK_COMMANDS.refresh]: async () => refresh(),
      [STACK_COMMANDS.chooseModule]: async () => {
        const chosen = await rootToAct(picking, api.window, 'show the stacks of');
        if (chosen) show(chosen);
      },
      [STACK_COMMANDS.preview]: onStack('preview', (of, stack) =>
        runOnStack(BINDINGS.preview, of, stack),
      ),
      [STACK_COMMANDS.apply]: onStack('apply', apply),
      [STACK_COMMANDS.scan]: onStack('scan', (of, stack) => runOnStack(BINDINGS.scan, of, stack)),
      [STACK_COMMANDS.followLogs]: onRun(async (row) => {
        runOutput.show(row.stack.slug);
        const ctx: RunCtx = { root: rootPath(row.root), stack: row.stack };
        await runner.run(BINDINGS.followLogs, ctx, { runId: row.run.id });
      }),
      [STACK_COMMANDS.cancel]: onRun(async (row) => {
        const ctx: RunCtx = { root: rootPath(row.root), stack: row.stack };
        await runner.run(BINDINGS.cancel, ctx, { runId: row.run.id });
      }),
      [STACK_COMMANDS.openInPortal]: onRun(async (row) => {
        if (row.run.url !== undefined) await api.env.openExternal(api.Uri.parse(row.run.url));
      }),
      [STACK_COMMANDS.openPortal]: async () => {
        if (refusal?.url !== undefined) await api.env.openExternal(api.Uri.parse(refusal.url));
      },
      [STACK_COMMANDS.createInTerminal]: async () => {
        if (!root) return;
        const terminal = api.window.createTerminal({ name: 'Lace', cwd: rootUri(root) });
        terminal.show();
        terminal.sendText(shellLine(api.env.shell, options.binaryPath(), CREATE_LINE), false);
      },
    }),
  ];
  const offActive = panels.onDidChangeActive(show);
  const offAccount = options.account.onDidChange(refresh);

  return {
    dispose() {
      offActive();
      offAccount();
      offStore();
      offTick();
      offBusy();
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
}
