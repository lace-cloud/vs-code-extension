// The manifest and activation agree. Every command, view and Language Model
// Tool the manifest contributes is one a feature registers, and the
// features register nothing the manifest lacks. Every menu entry and
// welcome link names a contributed command, every view a `when` clause
// names is contributed, a run row's actions are offered by its state, and
// the settings are the ones the extension reads.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { engineSettings } from '../engine/engine';
import { FEATURES, type WindowBase, windowHost } from '../features';
import { run } from '../stacks/__tests__/stack-fixtures';
import { runLook } from '../stacks/stack-rows';

const ROOT = resolve(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const contributes = manifest.contributes;

type View = { id: string; name: string; type?: string };
type MenuEntry = { command: string; when?: string };

// What the features register, each kind by its id, once every feature has
// run over a window whose API records it.
function registered() {
  const commands: string[] = [];
  const webviewViews: string[] = [];
  const treeViews: string[] = [];
  const tools: string[] = [];
  const disposable = { dispose: () => {} };
  const base = {
    api: {
      commands: {
        registerCommand: (id: string) => {
          commands.push(id);
          return disposable;
        },
        executeCommand: vi.fn(),
      },
      window: {
        createStatusBarItem: () => ({ show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }),
        createTreeView: (id: string) => {
          treeViews.push(id);
          return {
            ...disposable,
            onDidChangeSelection: () => disposable,
            onDidChangeVisibility: () => disposable,
          };
        },
        registerWebviewViewProvider: (id: string) => {
          webviewViews.push(id);
          return disposable;
        },
        onDidChangeWindowState: () => disposable,
        onDidChangeActiveTextEditor: () => disposable,
        showErrorMessage: vi.fn(),
      },
      workspace: {
        registerTextDocumentContentProvider: () => disposable,
        onDidChangeWorkspaceFolders: () => disposable,
      },
      lm: {
        registerTool: (name: string) => {
          tools.push(name);
          return disposable;
        },
      },
      EventEmitter: class {
        event = () => disposable;
        fire() {}
        dispose() {}
      },
    },
    context: {
      extensionUri: { path: '/ext', with: () => ({}) },
      workspaceState: { get: () => ({}), update: vi.fn() },
      globalState: { get: () => [], update: vi.fn() },
    },
    engine: {
      state: () => 'stopped',
      onState: () => () => {},
      caller: () => Promise.reject(new Error('no engine in this test')),
    },
    rootSessions: { observe: () => ({ of: () => undefined, dispose: () => {} }), held: () => [] },
    autosave: { pageFocus: vi.fn() },
    log: { show: vi.fn() },
    report: vi.fn(),
  } as unknown as WindowBase;
  const host = windowHost(base);
  for (const feature of FEATURES) feature(host).dispose();
  return {
    commands: commands.sort(),
    webviewViews: webviewViews.sort(),
    treeViews: treeViews.sort(),
    tools: tools.sort(),
  };
}

const declaredCommands = (): string[] =>
  contributes.commands.map((c: { command: string }) => c.command).sort();
const views = (): View[] => contributes.views.laceContainer;
const menuEntries = (): MenuEntry[] => Object.values<MenuEntry[]>(contributes.menus).flat();
const welcomes = (): { view: string; when?: string; contents: string }[] =>
  contributes.viewsWelcome;

// Whether a `when` clause holds for a row of `view` whose contextValue is
// `viewItem`, read as VS Code reads the terms a row's menu uses: `&&` of
// `view == <id>`, `viewItem == <value>` and `viewItem =~ /<regex>/<flags>`.
function holds(when: string, row: { view: string; viewItem: string }): boolean {
  return when.split('&&').every((part) => {
    const term = part.trim();
    const equals = /^(view|viewItem) == (\S+)$/.exec(term);
    if (equals) return row[equals[1] as 'view' | 'viewItem'] === equals[2];
    const matches = /^viewItem =~ \/(.*)\/([a-z]*)$/.exec(term);
    if (matches) return new RegExp(matches[1], matches[2]).test(row.viewItem);
    throw new Error(`a when term this test does not read: ${term}`);
  });
}

// What a run row offers, by its run's state: Follow Logs on every run, Open
// in Portal on a run with a page, Cancel Run on a run that has not ended.
type RunState = { ended: boolean; portal: boolean };
const RUN_ACTIONS: Record<string, (state: RunState) => boolean> = {
  'lace.followRunLogs': () => true,
  'lace.openRunInPortal': ({ portal }) => portal,
  'lace.cancelRun': ({ ended }) => !ended,
};
// Every state a run row draws, with the contextValue `runLook` gives it.
const RUN_ROWS = [false, true].flatMap((ended) =>
  [false, true].map((portal) => ({
    state: { ended, portal },
    viewItem: runLook(
      run('run_1', 'applying', {
        ...(ended ? { completedAt: '2026-09-01T01:00:00Z' } : {}),
        ...(portal ? { url: 'https://portal/o/t/stacks/stk_1/runs/run_1' } : {}),
      }),
    ).contextValue,
  })),
);

describe('the manifest', () => {
  test('declares exactly the commands the features register', () => {
    expect(registered().commands).toEqual(declaredCommands());
  });

  test('declares exactly the views the features register, each as the kind it is', () => {
    const { webviewViews, treeViews } = registered();
    expect(views().map((view) => view.id)).toEqual(['laceRegistry', 'laceStacks']);
    expect(
      views()
        .filter((view) => view.type === 'webview')
        .map((view) => view.id)
        .sort(),
    ).toEqual(webviewViews);
    expect(
      views()
        .filter((view) => view.type !== 'webview')
        .map((view) => view.id)
        .sort(),
    ).toEqual(treeViews);
  });

  test('declares exactly the Language Model Tools the features register', () => {
    const declared = contributes.languageModelTools.map((tool: { name: string }) => tool.name);
    expect(registered().tools).toEqual([...declared].sort());
  });

  test('names only contributed commands in its menus and welcome links', () => {
    const commands = new Set(declaredCommands());
    const named = [
      ...menuEntries().map((entry) => entry.command),
      ...welcomes().flatMap((welcome) =>
        [...welcome.contents.matchAll(/\(command:([\w.]+)\)/g)].map(([, command]) => command),
      ),
    ];
    expect(named.filter((command) => !commands.has(command))).toEqual([]);
  });

  test('names only contributed views in its when clauses and welcomes', () => {
    const ids = new Set(views().map((view) => view.id));
    const clauses = [
      ...menuEntries().map((entry) => entry.when ?? ''),
      ...welcomes().map((welcome) => welcome.when ?? ''),
    ];
    const named = [
      ...clauses.flatMap((when) => [...when.matchAll(/\bview == (\w+)/g)].map(([, id]) => id)),
      ...welcomes().map((welcome) => welcome.view),
    ];
    expect(named.filter((id) => !ids.has(id))).toEqual([]);
  });

  test("offers each action on a run row exactly where the run's state allows it", () => {
    const onRuns = (contributes.menus['view/item/context'] as MenuEntry[]).filter((entry) =>
      entry.when?.includes('laceRun'),
    );
    expect([...new Set(onRuns.map((entry) => entry.command))].sort()).toEqual(
      Object.keys(RUN_ACTIONS).sort(),
    );
    const offered = onRuns.flatMap((entry) =>
      RUN_ROWS.map(({ state, viewItem }) => ({
        command: entry.command,
        state,
        offered: holds(entry.when ?? '', { view: 'laceStacks', viewItem }),
      })),
    );
    expect(offered).toEqual(
      offered.map((each) => ({ ...each, offered: RUN_ACTIONS[each.command](each.state) })),
    );
  });

  test('declares exactly the settings the extension reads', () => {
    const read: string[] = [];
    const settings = engineSettings({
      getConfiguration: (section?: string) =>
        ({
          get: (key: string, fallback: unknown) => {
            read.push(`${section}.${key}`);
            return fallback;
          },
        }) as never,
    });
    settings.binaryPath();
    settings.autoRestart();
    expect(Object.keys(contributes.configuration.properties)).toEqual(read);
    expect(contributes.configuration.properties['lace.binaryPath'].scope).toBe(
      'machine-overridable',
    );
  });

  test('runs only in a trusted folder on disk', () => {
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe(false);
    expect(manifest.capabilities.virtualWorkspaces.supported).toBe(false);
  });
});
