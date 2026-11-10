import { type CanvasSource, ConnectError, Reason, type SourceEnd } from '@lace-cloud/canvas/engine';
import type { MessageBridge } from '@lace-cloud/proto';
import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { RootHold } from '../../engine/root-sessions';
import { folder, fsPath, uri } from '../../roots/__tests__/fake-uri';
import type { AuthoringRoot } from '../../roots/authoring-roots';
import { createRootState } from '../../state/root-state';
import { type Button, clicked, shownBy } from '../../vscode/__tests__/fake-messages';
import { CANVAS_VIEW_TYPE, canvasUri, createCanvasPanels } from '../canvas-panels';
import { customEditors, fakePanel, macrotask } from './fake-custom-editor';

const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };
const other: AuthoringRoot = { folder: repo, relative: 'infra/other' };
// The directory of `prod` as the engine is told it.
const PROD = fsPath('/work/repo/infra/prod');

const frame = (over: Partial<CanvasSource> = {}): CanvasSource =>
  ({
    unsaved: false,
    workingDigest: over.unsaved ? 'working' : 'saved',
    sourceRefused: false,
    ...over,
  }) as CanvasSource;

// A hold whose session frames and renewals the test drives.
function fakeHold(root: string, unsaved = false) {
  // The listeners of the session the hold is on; a renewal puts it on a new
  // session, which its old listeners never hear.
  let frames = new Set<(s: CanvasSource) => void>();
  const renewals = new Set<() => void>();
  const release = vi.fn(async () => {});
  const save = vi.fn(async () => {});
  const apply = vi.fn(async (_actions: unknown[]) => ({
    success: true,
    errors: [] as { message: string }[],
    created: [],
    ties: [],
  }));
  const hold = {
    root,
    sessionId: root === PROD ? 'session' : `session:${root}`,
    ports: {
      editor: { save, apply },
      source: {
        subscribe: (on: (s: CanvasSource) => void, _end: (e: SourceEnd) => void) => {
          const mine = frames;
          mine.add(on);
          on(frame({ unsaved }));
          return () => mine.delete(on);
        },
      },
    },
    renewed: (listener: () => void) => {
      renewals.add(listener);
      return () => renewals.delete(listener);
    },
    release,
  } as unknown as RootHold & { release: typeof release };
  return {
    hold,
    save,
    apply,
    publish: (s: CanvasSource) => {
      for (const on of [...frames]) on(s);
    },
    renew: () => {
      frames = new Set();
      for (const listener of [...renewals]) listener();
    },
  };
}

type Uri = vscode.Uri;

// The window's workspaceState: what it keeps, and each update.
function workspaceState() {
  const kept = new Map<string, unknown>();
  return {
    keys: () => [...kept.keys()],
    get: ((key: string, fallback?: unknown) => (kept.has(key) ? kept.get(key) : fallback)) as never,
    update: vi.fn(async (key: string, value: unknown) => {
      kept.set(key, value);
    }),
  };
}

function setup(
  options: {
    // The workspace's folders; the one the roots are under by default.
    folders?: AuthoringRoot['folder'][];
    // What the engine's first serves fail with, in turn.
    serveFails?: Error[];
    // Whether the session is unsaved when the canvas takes it.
    unsaved?: boolean;
    // The engine answers an acquire only when `openAcquire` is called.
    pendingAcquire?: boolean;
  } = {},
) {
  let openAcquire = () => {};
  const gate = options.pendingAcquire
    ? new Promise<void>((resolve) => {
        openAcquire = resolve;
      })
    : undefined;
  const editors = customEditors((show) => events.push(`create:${show.preserveFocus}`));
  const { panels, documents } = editors;
  const holds = new Map<string, ReturnType<typeof fakeHold>>();
  const served: { bridge: MessageBridge; dispose: ReturnType<typeof vi.fn> }[] = [];
  const events: string[] = [];
  const reports: { what: string; error: unknown }[] = [];
  // Who hears a change of the workspace's folders.
  const folderChanges = new Set<() => void>();
  const api = {
    window: {
      // The text editor the developer is in, when the active group holds one.
      activeTextEditor: undefined as { viewColumn?: number } | undefined,
      ...editors.window,
      showInformationMessage: vi.fn(async () => undefined),
      showWarningMessage: vi.fn(async () => undefined),
      showErrorMessage: vi.fn(
        async (_text: string, ..._buttons: Button[]): Promise<Button | undefined> => undefined,
      ),
      showTextDocument: vi.fn(async () => {}),
    },
    commands: editors.commands,
    EventEmitter: editors.EventEmitter,
    workspace: {
      save: vi.fn(async (at: Uri) => at),
      workspaceFolders: options.folders ?? [repo],
      openTextDocument: vi.fn(async (opened: { path?: string }) => {
        if (opened.path?.endsWith('/missing.tf')) {
          throw new Error(`cannot open file://${opened.path}`);
        }
        return { opened };
      }),
      onDidChangeWorkspaceFolders: (listener: () => void) => {
        folderChanges.add(listener);
        return { dispose: () => folderChanges.delete(listener) };
      },
    },
    ViewColumn: { Active: -1, Beside: -2 },
    TabInputCustom: editors.TabInputCustom,
    Range: class {
      constructor(
        readonly startLine: number,
        readonly startCharacter: number,
        readonly endLine: number,
        readonly endCharacter: number,
      ) {}
    },
  };
  const rootSessions = {
    acquire: vi.fn(async (root: string) => {
      await gate;
      events.push(`acquire:${root}`);
      const made = fakeHold(root, options.unsaved);
      holds.set(root, made);
      return made.hold;
    }),
  };
  const engine = {
    serve: vi.fn(async (bridge: MessageBridge) => {
      events.push('serve');
      const fails = options.serveFails?.shift();
      if (fails) throw fails;
      const dispose = vi.fn(() => {
        events.push('unserve');
      });
      served.push({ bridge, dispose });
      return dispose;
    }),
  };
  const storage = workspaceState();
  const rootState = createRootState(storage);
  const confirm = vi.fn(async () => true);
  const pageFocus = vi.fn();
  const released = vi.fn();
  const claimedSave: { current?: () => Promise<void> } = {};
  const claimSaving = vi.fn((root: string, save: () => Promise<void>) => {
    events.push(`claim:${root}`);
    claimedSave.current = save;
    return released;
  });
  const offers = {
    signIn: vi.fn(),
    selectOrganization: vi.fn(),
    selectTeam: vi.fn(),
    openPortal: vi.fn(),
    install: vi.fn(),
    openRecord: vi.fn(),
  };
  const validate = vi.fn(async () => {});
  // Import Existing Resources on a root, which settles when the test says.
  const imported: { root: AuthoringRoot; end: () => void }[] = [];
  const importResources = vi.fn(
    (root: AuthoringRoot) =>
      new Promise<void>((end) => {
        imported.push({ root, end });
      }),
  );
  const generated = vi.fn(async () => {});
  const canvasPanels = createCanvasPanels({
    api: api as never,
    extensionUri: uri('/ext'),
    engine,
    rootSessions,
    rootState,
    confirm,
    pageFocus,
    claimSaving,
    offers,
    validate,
    importResources,
    generated,
    report: (what, error) => reports.push({ what, error }),
  });
  return {
    api,
    canvasPanels,
    panels,
    // The workspace's folders become `folders`, and VS Code says so.
    changeFolders: (folders: AuthoringRoot['folder'][]) => {
      api.workspace.workspaceFolders = folders;
      for (const listener of [...folderChanges]) listener();
    },
    folderChanges,
    holds,
    served,
    engine,
    events,
    documents,
    editors,
    provider: editors.provider,
    openAcquire: () => openAcquire(),
    claimSaving,
    claimedSave,
    released,
    reports,
    storage,
    confirm,
    rootState,
    pageFocus,
    offers,
    validate,
    importResources,
    imported,
    generated,
  };
}

// The engine's frame for the session of `prod`; an unsaved one carries
// `digest` as its working digest.
const unsaved = (canvas: ReturnType<typeof setup>, value: boolean, digest = 'working') =>
  canvas.holds
    .get(PROD)
    ?.publish(frame({ unsaved: value, workingDigest: value ? digest : 'saved' }));

// The page of the canvas at `at` reports the working digest it drew.
const draws = (canvas: ReturnType<typeof setup>, digest: string, at = 0) =>
  canvas.panels[at].receive({
    ch: 'host',
    frame: { kind: 'notice', notice: { op: 'digest', value: digest } },
  });

// The document changes VS Code is told of.
function listening(canvas: ReturnType<typeof setup>) {
  const told: unknown[] = [];
  canvas.provider().onDidChangeCustomDocument(((e: unknown) => told.push(e)) as never);
  return told;
}

// The document of a root's canvas, as VS Code opens it on its own.
const opening = (canvas: ReturnType<typeof setup>, path = '/work/repo/infra/prod') =>
  canvas.provider().openCustomDocument(uri(path, 'lace-canvas'), {} as never, undefined as never);

// The resolve VS Code starts on its own (a tab restored on reload).
async function restoring(canvas: ReturnType<typeof setup>) {
  const document = await opening(canvas);
  const restored = fakePanel();
  const resolving = canvas
    .provider()
    .resolveCustomEditor(document, restored.panel as never, undefined as never);
  await macrotask();
  return { restored, resolving, document };
}

describe('ensure', () => {
  test('holds the session at panel creation, before the page boots, and resolves once the hold exists', async () => {
    const { canvasPanels, events, holds, panels } = setup();
    const made = await canvasPanels.ensure(prod);

    expect(events).toEqual(['create:false', `acquire:${PROD}`, `claim:${PROD}`, 'serve']);
    expect(made.hold).toBe(holds.get(PROD)?.hold);
    expect(panels[0].panel.webview.html).toContain('canvas-webview.js');
    expect(panels[0].panel.webview.html).toContain("script-src 'nonce-");
  });

  test('two ensure calls give one panel; a later one reveals it in its own column', async () => {
    const { canvasPanels, panels, api } = setup();
    const [a, b] = await Promise.all([canvasPanels.ensure(prod), canvasPanels.ensure(prod)]);
    api.window.activeTextEditor = { viewColumn: 2 };
    const c = await canvasPanels.ensure(prod, { preserveFocus: true });
    await canvasPanels.ensure(prod);

    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(api.commands.executeCommand).toHaveBeenCalledTimes(1);
    expect(panels[0].panel.reveal.mock.calls).toEqual([
      [1, true],
      [1, undefined],
    ]);
  });

  test("revealed without focus in the active text editor's own group, the canvas goes beside it, leaving the editor shown", async () => {
    const { canvasPanels, panels, api } = setup();
    await canvasPanels.ensure(prod);
    api.window.activeTextEditor = { viewColumn: 1 };
    await canvasPanels.ensure(prod, { preserveFocus: true });
    await canvasPanels.ensure(prod);

    expect(panels[0].panel.reveal.mock.calls).toEqual([
      [api.ViewColumn.Beside, true],
      [1, undefined],
    ]);
  });

  const shownIn = (viewColumn: number, preserveFocus: boolean) => [
    'vscode.openWith',
    expect.objectContaining({ scheme: 'lace-canvas', path: '/work/repo/infra/prod' }),
    CANVAS_VIEW_TYPE,
    { viewColumn, preserveFocus },
  ];

  test('opened without focus while a text editor is active, the panel is created beside it, taking no focus', async () => {
    const { canvasPanels, api } = setup();
    api.window.activeTextEditor = {};
    await canvasPanels.ensure(prod, { preserveFocus: true });
    expect(api.commands.executeCommand).toHaveBeenCalledWith(
      ...shownIn(api.ViewColumn.Beside, true),
    );
  });

  test('opened without focus with no text editor active, the panel is created in the active group, taking no focus', async () => {
    const { canvasPanels, api } = setup();
    await canvasPanels.ensure(prod, { preserveFocus: true });
    expect(api.commands.executeCommand).toHaveBeenCalledWith(
      ...shownIn(api.ViewColumn.Active, true),
    );
  });

  test('opened with focus, the panel is created in the active group over the text editor there', async () => {
    const { canvasPanels, api } = setup();
    api.window.activeTextEditor = {};
    await canvasPanels.ensure(prod);
    expect(api.commands.executeCommand).toHaveBeenCalledWith(
      ...shownIn(api.ViewColumn.Active, false),
    );
  });

  test('in a workspace of several folders the title names the folder first', async () => {
    const second = folder('/work/api', 1);
    const { canvasPanels, panels } = setup({ folders: [repo, second] });
    await canvasPanels.ensure(prod);
    await canvasPanels.ensure({ folder: second, relative: 'infra/prod' });
    await canvasPanels.ensure({ folder: second, relative: '' });
    expect(panels.map((page) => page.panel.title)).toEqual([
      'repo/infra/prod',
      'api/infra/prod',
      'api',
    ]);
  });

  test("when the workspace's folders change, each tab is titled by the folders open now", async () => {
    const second = folder('/work/api', 1);
    const { canvasPanels, panels, changeFolders } = setup({ folders: [repo] });
    await canvasPanels.ensure(prod);
    await canvasPanels.ensure(other);
    const [page, beside] = panels;

    changeFolders([repo, second]);
    expect(page.panel.title).toBe('repo/infra/prod');
    expect(beside.panel.title).toBe('repo/infra/other');

    changeFolders([repo]);
    expect(page.panel.title).toBe('infra/prod');
  });

  test("a tab whose folder left the workspace stays open on its session, titled by its directory's full path", async () => {
    const api = folder('/work/api', 0);
    const web = folder('/work/web', 1);
    const { canvasPanels, panels, holds, changeFolders } = setup({ folders: [api, web] });
    await canvasPanels.ensure({ folder: web, relative: 'infra/prod' });
    const [page] = panels;
    expect(page.panel.title).toBe('web/infra/prod');

    changeFolders([api]);
    expect(page.panel.title).toBe(fsPath('/work/web/infra/prod'));
    expect(page.disposed()).toBe(false);
    expect(holds.get(fsPath('/work/web/infra/prod'))?.hold.release).not.toHaveBeenCalled();
  });

  test('a failure the panel reports names the root as the workspace names it then', async () => {
    const second = folder('/work/api', 1);
    const { canvasPanels, panels, reports, changeFolders } = setup({ folders: [repo] });
    await canvasPanels.ensure(prod);
    canvasPanels.onDidChangeActive(() => {
      throw new Error('listener');
    });

    changeFolders([repo, second]);
    panels[0].activate();
    expect(reports.map(({ what }) => what)).toEqual([
      'the canvas of repo/infra/prod becoming active',
    ]);
  });

  test("a closed tab hears no further change of the workspace's folders", async () => {
    const { canvasPanels, panels, folderChanges } = setup();
    await canvasPanels.ensure(prod);
    expect(folderChanges.size).toBe(1);
    panels[0].panel.dispose();
    expect(folderChanges.size).toBe(0);
  });

  test('two roots are two panels, and the active one names the active root', async () => {
    const { canvasPanels, panels } = setup();
    await canvasPanels.ensure(prod);
    await canvasPanels.ensure(other);
    expect(panels).toHaveLength(2);
    expect(canvasPanels.activeRoot()).toBeUndefined();
    panels[1].panel.active = true;
    expect(canvasPanels.activeRoot()).toEqual(other);
  });

  test("the open roots are every panel's, active or not, and a closed panel's root leaves them", async () => {
    const { canvasPanels, panels } = setup();
    await canvasPanels.ensure(prod);
    await canvasPanels.ensure(other);
    expect(canvasPanels.roots()).toEqual([prod, other]);
    panels[0].panel.dispose();
    expect(canvasPanels.roots()).toEqual([other]);
  });

  test('a serve that fails once the hold is taken closes the blank panel and releases the hold; the next ensure opens the root again', async () => {
    const restarted = new Error('the engine speaks another protocol');
    const { canvasPanels, panels, holds, pageFocus } = setup({ serveFails: [restarted] });

    await expect(canvasPanels.ensure(prod)).rejects.toBe(restarted);
    await macrotask();
    expect(panels[0].disposed()).toBe(true);
    expect(holds.get(PROD)?.hold.release).toHaveBeenCalledOnce();
    expect(pageFocus).toHaveBeenCalledWith('session', false);

    const made = await canvasPanels.ensure(prod);
    expect(panels).toHaveLength(2);
    expect(made.panel).toBe(panels[1].panel);
    expect(made.hold.release).not.toHaveBeenCalled();
  });

  test('a refused acquire rejects and closes the panel VS Code made, which held nothing', async () => {
    const { api, panels } = setup();
    const refused = new Error('locked');
    const rootSessions = { acquire: vi.fn(async () => Promise.reject(refused)) };
    const failing = createCanvasPanels({
      api: api as never,
      extensionUri: uri('/ext'),
      engine: { serve: vi.fn() },
      rootSessions,
      rootState: createRootState(workspaceState()),
      confirm: vi.fn(),
      pageFocus: vi.fn(),
      claimSaving: vi.fn(),
      offers: {} as never,
      validate: vi.fn(),
      importResources: vi.fn(),
      generated: vi.fn(),
      report: vi.fn(),
    });
    await expect(failing.ensure(prod)).rejects.toBe(refused);
    expect(panels[0].disposed()).toBe(true);
    // The next ensure asks again.
    await expect(failing.ensure(prod)).rejects.toBe(refused);
    expect(rootSessions.acquire).toHaveBeenCalledTimes(2);
  });
});

describe('the page and the host', () => {
  test('boot answers the root as the engine was told it and the kept arrangement', async () => {
    const { canvasPanels, panels, rootState } = setup();
    await rootState.arrange(prod, { saved: 1 } as never);
    await canvasPanels.ensure(prod);
    const page = panels[0];

    page.receive({ ch: 'host', frame: { kind: 'call', id: '1', name: 'boot', request: {} } });
    await macrotask();
    expect(page.posted).toEqual([
      {
        ch: 'host',
        frame: {
          kind: 'reply',
          id: '1',
          response: { root: PROD, arrangement: { saved: 1 } },
        },
      },
    ]);
  });

  test('an arrangement notice is kept per root; notify shows a message; confirm asks', async () => {
    const { canvasPanels, panels, rootState, api, confirm } = setup();
    await canvasPanels.ensure(prod);
    const page = panels[0];
    const notice = (n: unknown) =>
      page.receive({ ch: 'host', frame: { kind: 'notice', notice: n } });

    notice({ op: 'arrangement', value: { a: {} } });
    await macrotask();
    expect(rootState.arrangement(prod)).toEqual({ a: {} });

    notice({ op: 'notify', level: 'error', text: 'broke' });
    notice({ op: 'notify', level: 'info', text: 'done' });
    expect(api.window.showErrorMessage).toHaveBeenCalledWith('broke');
    expect(api.window.showInformationMessage).toHaveBeenCalledWith('done');

    page.receive({
      ch: 'host',
      frame: { kind: 'call', id: '2', name: 'confirm', request: { text: 'sure?', typed: 'x' } },
    });
    await macrotask();
    expect(confirm).toHaveBeenCalledWith({ text: 'sure?', typed: 'x' });
    expect(page.posted.at(-1)).toEqual({
      ch: 'host',
      frame: { kind: 'reply', id: '2', response: true },
    });
  });

  test("Open source opens the root's file beside the canvas at the diagnostic's line and column, and a file that is not there fails the call naming it", async () => {
    const { canvasPanels, panels, api } = setup();
    await canvasPanels.ensure(prod);
    const page = panels[0];
    const call = (id: string, request: unknown) =>
      page.receive({ ch: 'host', frame: { kind: 'call', id, name: 'openSource', request } });

    call('3', { file: 'network/main.tf', line: 4, column: 2 });
    await macrotask();
    expect(api.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/work/repo/infra/prod/network/main.tf' }),
    );
    expect(api.window.showTextDocument).toHaveBeenCalledWith(
      { opened: expect.objectContaining({ path: '/work/repo/infra/prod/network/main.tf' }) },
      {
        viewColumn: -2,
        selection: { startLine: 3, startCharacter: 1, endLine: 3, endCharacter: 1 },
      },
    );
    expect(page.posted.at(-1)).toEqual({
      ch: 'host',
      frame: { kind: 'reply', id: '3', response: null },
    });

    call('4', { file: 'variables.tf' });
    await macrotask();
    expect(api.window.showTextDocument).toHaveBeenLastCalledWith(expect.anything(), {
      viewColumn: -2,
      selection: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
    });

    call('5', { file: 'missing.tf', line: 1 });
    await macrotask();
    expect(page.posted.at(-1)).toEqual({
      ch: 'host',
      frame: {
        kind: 'fail',
        id: '5',
        message:
          'Lace could not open missing.tf in infra/prod: cannot open file:///work/repo/infra/prod/missing.tf',
      },
    });
  });

  test("a notice the page sends with a command's failure offers the ways out its reason names; Validate validates the panel's root", async () => {
    const { canvasPanels, panels, api, offers, validate } = setup();
    api.window.showErrorMessage.mockImplementation(async (text, ...buttons) =>
      clicked(buttons, text.startsWith('Error: 1 construct') ? 'Validate' : 'Open Portal'),
    );
    await canvasPanels.ensure(prod);
    const page = panels[0];
    const notice = (n: unknown) =>
      page.receive({ ch: 'host', frame: { kind: 'notice', notice: n } });

    notice({
      op: 'notify',
      level: 'error',
      text: 'Error: 1 construct could not be converted',
      failure: { reason: 'source_refused', message: '1 construct could not be converted' },
    });
    await macrotask();
    expect(shownBy(api.window.showErrorMessage)).toContainEqual([
      'Error: 1 construct could not be converted',
      'Validate',
    ]);
    expect(validate).toHaveBeenCalledWith(prod);

    notice({
      op: 'notify',
      level: 'error',
      text: 'no team',
      failure: { reason: 'no_team', message: 'no team', url: 'https://portal/teams/new' },
    });
    await macrotask();
    expect(shownBy(api.window.showErrorMessage)).toContainEqual([
      'no team',
      'Select Team',
      'Open Portal',
    ]);
    expect(offers.openPortal).toHaveBeenCalledWith({
      kind: 'openPortal',
      url: 'https://portal/teams/new',
    });
  });

  test("Import existing resources on the banner runs Import Existing Resources on the panel's root, and the call answers once it has ended", async () => {
    const { canvasPanels, panels, importResources, imported } = setup();
    await canvasPanels.ensure(prod);
    const page = panels[0];

    page.receive({
      ch: 'host',
      frame: { kind: 'call', id: '6', name: 'importResources', request: {} },
    });
    await macrotask();
    expect(importResources).toHaveBeenCalledWith(prod);
    expect(page.posted).toEqual([]);

    imported[0].end();
    await macrotask();
    expect(page.posted).toEqual([
      { ch: 'host', frame: { kind: 'reply', id: '6', response: null } },
    ]);
  });

  test("the canvas's own Generate ends with the notice Lace: Generate shows, for the panel's root", async () => {
    const { canvasPanels, panels, generated } = setup();
    const tree = { changed: ['main.tf'], removed: [], unchanged: 1, treeChanged: true };
    await canvasPanels.ensure(prod);
    panels[0].receive({
      ch: 'host',
      frame: { kind: 'notice', notice: { op: 'generated', tree } },
    });
    await macrotask();
    expect(generated).toHaveBeenCalledWith(prod, tree);
  });

  test('an observer that fails is reported, and the next notice still lands', async () => {
    const { canvasPanels, panels, storage, reports, pageFocus } = setup();
    storage.update.mockRejectedValueOnce(new Error('storage'));
    await canvasPanels.ensure(prod);
    const page = panels[0];

    page.receive({
      ch: 'host',
      frame: { kind: 'notice', notice: { op: 'arrangement', value: {} } },
    });
    await macrotask();
    page.receive({ ch: 'host', frame: { kind: 'notice', notice: { op: 'focus', value: true } } });

    expect(reports.map((r) => String(r.error))).toEqual(['Error: storage']);
    expect(pageFocus).toHaveBeenCalledWith('session', true);
  });
});

describe('the stack, the tick and the focus', () => {
  const boot = { ch: 'host', frame: { kind: 'call', id: '1', name: 'boot', request: {} } };

  test('the page boots with the stack picked for its root', async () => {
    const { canvasPanels, panels, rootState } = setup();
    await rootState.pickStack(prod, { id: 'stk_1', slug: 'prod' });
    await canvasPanels.ensure(prod);
    panels[0].receive(boot);
    await macrotask();
    expect(panels[0].posted).toEqual([
      {
        ch: 'host',
        frame: {
          kind: 'reply',
          id: '1',
          response: {
            root: PROD,
            arrangement: {},
            stack: { id: 'stk_1', slug: 'prod' },
          },
        },
      },
    ]);
  });

  test("a later pick reaches the root's page and no other", async () => {
    const { canvasPanels, panels, rootState } = setup();
    await canvasPanels.ensure(prod);
    await canvasPanels.ensure(other);

    await rootState.pickStack(prod, { id: 'stk_2', slug: 'staging' });
    expect(panels[0].posted).toEqual([
      {
        ch: 'host',
        frame: { kind: 'event', event: { op: 'stack', value: { id: 'stk_2', slug: 'staging' } } },
      },
    ]);
    expect(panels[1].posted).toEqual([]);
  });

  test("a tick reaches the root's page and no other; a root with no page is no error", async () => {
    const { canvasPanels, panels } = setup();
    await canvasPanels.ensure(prod);
    canvasPanels.tick(prod);
    canvasPanels.tick(other);
    expect(panels[0].posted).toEqual([
      { ch: 'host', frame: { kind: 'event', event: { op: 'tick' } } },
    ]);
  });

  test('the page’s focus reaches the autosave policy with the session it is on, and closing the tab is a blur', async () => {
    const { canvasPanels, panels, pageFocus } = setup();
    await canvasPanels.ensure(prod);
    const notice = (n: unknown) =>
      panels[0].receive({ ch: 'host', frame: { kind: 'notice', notice: n } });

    notice({ op: 'focus', value: true });
    notice({ op: 'focus', value: false });
    panels[0].panel.dispose();
    await macrotask();
    expect(pageFocus.mock.calls).toEqual([
      ['session', true],
      ['session', false],
      ['session', false],
    ]);
  });

  test('a panel becoming active is announced with its root', async () => {
    const { canvasPanels, panels } = setup();
    const activated = vi.fn();
    canvasPanels.onDidChangeActive(activated);
    await canvasPanels.ensure(prod);
    await canvasPanels.ensure(other);
    panels[1].activate();
    expect(activated).toHaveBeenCalledWith(other);
    expect(activated).toHaveBeenCalledTimes(1);
  });
});

describe('a reboot', () => {
  test('disposes the bridge it served, serves a new one, and assigns different HTML', async () => {
    const { canvasPanels, panels, holds, served, events } = setup();
    await canvasPanels.ensure(prod);
    const before = panels[0].panel.webview.html;
    events.length = 0;

    holds.get(PROD)?.renew();
    await macrotask();

    expect(events).toEqual(['unserve', 'serve']);
    expect(served[0].dispose).toHaveBeenCalledTimes(1);
    expect(panels[0].panel.webview.html).not.toBe(before);
  });
});

describe('closing the tab', () => {
  test('disposes the bridge, then releases the hold', async () => {
    const { canvasPanels, panels, holds, events } = setup();
    await canvasPanels.ensure(prod);
    const hold = holds.get(PROD)!;
    hold.hold.release.mockImplementation(async () => {
      events.push('release');
    });
    events.length = 0;

    panels[0].panel.dispose();
    await macrotask();

    expect(events).toEqual(['unserve', 'release']);
    // The root has no panel now: the next ensure creates one.
    await canvasPanels.ensure(prod);
    expect(panels).toHaveLength(2);
  });

  test('the engine’s answers to the page after the tab closed go nowhere', async () => {
    const { canvasPanels, panels, served } = setup();
    await canvasPanels.ensure(prod);
    panels[0].panel.dispose();
    await macrotask();

    const status = { id: 1, status: { code: 1, message: 'cancelled' } };
    expect(() => served[0].bridge.post(status as never)).not.toThrow();
    expect(panels[0].posted).toEqual([]);
  });
});

describe('a canvas with unsaved edits', () => {
  test('an unsaved frame marks the document dirty, once for each time it becomes unsaved', async () => {
    const canvas = setup();
    const told = listening(canvas);
    await canvas.canvasPanels.ensure(prod);
    const [document] = canvas.documents;

    unsaved(canvas, true);
    unsaved(canvas, true);

    expect(told).toEqual([{ document }]);
    expect(document.uri.toString()).toBe('lace-canvas:///work/repo/infra/prod');
  });

  test('a session already unsaved when the editor opens marks the document dirty', async () => {
    const canvas = setup({ unsaved: true });
    const told = listening(canvas);
    await canvas.canvasPanels.ensure(prod);

    expect(told).toEqual([{ document: canvas.documents[0] }]);
  });

  test('closing with Save saves the session once, then releases the hold', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const [page] = canvas.panels;
    const [document] = canvas.documents;
    const made = canvas.holds.get(PROD)!;
    made.save.mockImplementation(async () => {
      canvas.events.push('save');
    });
    made.hold.release.mockImplementation(async () => {
      canvas.events.push('release');
    });
    unsaved(canvas, true);
    canvas.events.length = 0;

    await canvas.provider().saveCustomDocument(document, undefined as never);
    page.panel.dispose();
    await macrotask();

    expect(made.save).toHaveBeenCalledOnce();
    expect(canvas.events.filter((e) => e === 'save' || e === 'release')).toEqual([
      'save',
      'release',
    ]);
  });

  test('a save that fails rejects with what the engine said, and the document stays dirty', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    unsaved(canvas, true);
    canvas.holds.get(PROD)?.save.mockRejectedValueOnce(new Error('refused'));

    await expect(
      canvas.provider().saveCustomDocument(canvas.documents[0], undefined as never),
    ).rejects.toThrow('Lace could not save the canvas of infra/prod: refused');
    expect(canvas.api.workspace.save).not.toHaveBeenCalled();
    expect(canvas.documents[0]).toBeDefined();
  });

  test('a save of a clean session does nothing; saves go one after another', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const [document] = canvas.documents;
    const made = canvas.holds.get(PROD)!;
    const provider = canvas.provider();

    await provider.saveCustomDocument(document, undefined as never);
    expect(made.save).not.toHaveBeenCalled();

    unsaved(canvas, true);
    made.save.mockImplementation(async () => {
      unsaved(canvas, false);
    });
    await Promise.all([
      provider.saveCustomDocument(document, undefined as never),
      provider.saveCustomDocument(document, undefined as never),
    ]);
    expect(made.save).toHaveBeenCalledOnce();
  });

  test("closing with Don't Save discards what the page drew without a save, then releases the hold", async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const [page] = canvas.panels;
    const made = canvas.holds.get(PROD)!;
    unsaved(canvas, true, 'w7');
    draws(canvas, 'w7');
    made.apply.mockImplementation(async () => {
      canvas.events.push('discard');
      unsaved(canvas, false);
      return { success: true, errors: [], created: [], ties: [] };
    });
    canvas.events.length = 0;

    await canvas.provider().revertCustomDocument(canvas.documents[0], undefined as never);
    page.panel.dispose();
    await macrotask();

    expect(made.apply).toHaveBeenCalledExactlyOnceWith([
      { discard: { expected_working_digest: 'w7' } },
    ]);
    expect(made.save).not.toHaveBeenCalled();
    expect(canvas.events.filter((e) => e === 'discard' || e === 'unserve')).toEqual([
      'discard',
      'unserve',
    ]);
    expect(made.hold.release).toHaveBeenCalledOnce();
    expect(canvas.released).toHaveBeenCalledWith(undefined);
  });

  test('a discard names the digest the page drew, not the one the engine holds now', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    unsaved(canvas, true, 'w1');
    draws(canvas, 'w1');
    // Another holder edited since: the engine holds w2, which the page has
    // not drawn.
    unsaved(canvas, true, 'w2');

    await canvas.provider().revertCustomDocument(canvas.documents[0], undefined as never);

    expect(canvas.holds.get(PROD)?.apply).toHaveBeenCalledWith([
      { discard: { expected_working_digest: 'w1' } },
    ]);
  });

  test('a discard the engine refuses rejects with its reason, and the document stays dirty', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    unsaved(canvas, true);
    draws(canvas, 'working');
    canvas.holds.get(PROD)?.apply.mockRejectedValueOnce(
      new ConnectError('failed_precondition', 'the working state changed', {
        reason: Reason.REASON_STALE_WORKING_STATE,
        api_code: '',
        request_id: '',
      }),
    );

    await expect(canvas.editors.revert(canvas.documents[0])).rejects.toThrow(
      /The edits of the canvas of infra\/prod were not discarded/,
    );
  });

  test('a revert of a clean session discards nothing; of an unsaved one the page has reported nothing for, it discards the latest frame’s digest', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const [document] = canvas.documents;
    const provider = canvas.provider();

    await provider.revertCustomDocument(document, undefined as never);
    expect(canvas.holds.get(PROD)?.apply).not.toHaveBeenCalled();

    unsaved(canvas, true);
    await provider.revertCustomDocument(document, undefined as never);
    expect(canvas.holds.get(PROD)?.apply).toHaveBeenCalledExactlyOnceWith([
      { discard: { expected_working_digest: 'working' } },
    ]);
  });

  test('the digest the page reported drawing is readable by the root’s directory', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    expect(canvas.canvasPanels.drawnDigest(PROD)).toBeUndefined();

    draws(canvas, 'w9');

    expect(canvas.canvasPanels.drawnDigest(PROD)).toBe('w9');
    expect(canvas.canvasPanels.drawnDigest(fsPath('/work/repo/infra/other'))).toBeUndefined();
  });

  test('a tab closed with unsaved edits ends the claim naming the digest it closed over', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    unsaved(canvas, true, 'w3');
    draws(canvas, 'w2');

    canvas.panels[0].panel.dispose();
    await macrotask();

    // The edits the session holds, not only those the page drew.
    expect(canvas.released).toHaveBeenCalledExactlyOnceWith('w3');
  });

  test('a tab closed after the edits were saved ends the claim declining nothing', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    unsaved(canvas, true);
    unsaved(canvas, false);

    canvas.panels[0].panel.dispose();
    await macrotask();

    expect(canvas.released).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  test('Cancel keeps the panel and its hold: VS Code calls nothing', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const [page] = canvas.panels;
    const told = listening(canvas);
    unsaved(canvas, true);
    await macrotask();

    expect(told).toEqual([{ document: canvas.documents[0] }]);
    expect(canvas.editors.isDirty(canvas.documents[0])).toBe(true);
    expect(page.disposed()).toBe(false);
    expect(canvas.holds.get(PROD)?.hold.release).not.toHaveBeenCalled();
    expect(canvas.holds.get(PROD)?.save).not.toHaveBeenCalled();
    expect(canvas.holds.get(PROD)?.apply).not.toHaveBeenCalled();
    expect(canvas.api.workspace.save).not.toHaveBeenCalled();
    expect(canvas.released).not.toHaveBeenCalled();
    expect(canvas.canvasPanels.roots()).toEqual([prod]);
  });

  test("a session saved another way clears the tab by saving that canvas's document and nothing else", async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    await canvas.canvasPanels.ensure(other);
    canvas.api.window.activeTextEditor = { viewColumn: 1 };
    unsaved(canvas, true);
    canvas.api.commands.executeCommand.mockClear();

    unsaved(canvas, false);

    expect(canvas.api.workspace.save).toHaveBeenCalledOnce();
    expect(canvas.api.workspace.save).toHaveBeenCalledWith(canvas.documents[0].uri);
    expect(canvas.api.commands.executeCommand).not.toHaveBeenCalled();
  });

  test('a session that was never dirty saves no document when its frames stay clean', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    unsaved(canvas, false);
    expect(canvas.api.workspace.save).not.toHaveBeenCalled();
  });

  test('a backup is refused, never made: the engine holds the unsaved edits', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    await expect(
      canvas
        .provider()
        .backupCustomDocument(
          canvas.documents[0],
          { destination: uri('/backup') },
          undefined as never,
        ),
    ).rejects.toThrow('Unsaved canvas edits are held by the engine, not backed up.');
  });

  test('there is no Save As', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    await expect(
      canvas
        .provider()
        .saveCustomDocumentAs(canvas.documents[0], uri('/elsewhere'), undefined as never),
    ).rejects.toThrow(/no Save As/);
  });

  test("a second editor on a root's session is closed, giving its hold back; the root keeps its one panel", async () => {
    const canvas = setup();
    const first = await canvas.canvasPanels.ensure(prod);
    const document = await opening(canvas);
    const second = fakePanel();

    await canvas
      .provider()
      .resolveCustomEditor(document, second.panel as never, undefined as never);
    await macrotask();

    expect(second.disposed()).toBe(true);
    expect(canvas.canvasPanels.roots()).toEqual([prod]);
    expect(first.hold.release).not.toHaveBeenCalled();
    expect(canvas.holds.get(PROD)?.hold.release).toHaveBeenCalledOnce();
  });

  test('a canvas whose folder is no longer open closes its tab quietly: no hold, no claim, no report', async () => {
    const canvas = setup();
    const document = await opening(canvas, '/work/gone/infra');
    const restored = fakePanel();

    await canvas
      .provider()
      .resolveCustomEditor(document, restored.panel as never, undefined as never);

    expect(document.root).toBeUndefined();
    expect(restored.disposed()).toBe(true);
    expect(canvas.holds.size).toBe(0);
    expect(canvas.claimSaving).not.toHaveBeenCalled();
    expect(canvas.reports).toEqual([]);
  });

  test('the document of a root on a drive named in capitals is the one its key names', async () => {
    const drive = folder('/C:/work/repo');
    const canvas = setup({ folders: [drive] });
    const root: AuthoringRoot = { folder: drive, relative: 'infra' };
    expect(canvasUri(root).path).toBe(
      process.platform === 'win32' ? '/c:/work/repo/infra' : '/C:/work/repo/infra',
    );
    await canvas.canvasPanels.ensure(root);
    expect(canvas.canvasPanels.roots()).toEqual([root]);
  });

  test("a canvas claims its root's saving from the first hold until the panel closes", async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    expect(canvas.claimSaving).toHaveBeenCalledWith(PROD, expect.any(Function));
    expect(canvas.released).not.toHaveBeenCalled();
    canvas.panels[0].panel.dispose();
    await macrotask();
    expect(canvas.released).toHaveBeenCalledOnce();
  });

  test('a failed first boot closes the panel, releases the hold and the claim', async () => {
    const canvas = setup({ serveFails: [new Error('no')] });
    await expect(canvas.canvasPanels.ensure(prod)).rejects.toThrow('no');
    await macrotask();
    expect(canvas.panels[0].disposed()).toBe(true);
    expect(canvas.holds.get(PROD)?.hold.release).toHaveBeenCalledOnce();
    expect(canvas.released).toHaveBeenCalledOnce();
  });
});

describe('a reboot of the session under a canvas', () => {
  test('the document follows the frames of the session the hold is on now', async () => {
    const canvas = setup();
    const told: unknown[] = [];
    canvas.provider().onDidChangeCustomDocument(((e: unknown) => told.push(e)) as never);
    await canvas.canvasPanels.ensure(prod);
    const made = canvas.holds.get(PROD)!;

    made.renew();
    await macrotask();
    made.publish(frame({ unsaved: true }));

    expect(told).toEqual([{ document: canvas.documents[0] }]);
  });
});

describe('a tab closed while its session is being taken', () => {
  test('gives the hold back once the engine answers, and takes no claim', async () => {
    const canvas = setup({ pendingAcquire: true });
    const opening = canvas.canvasPanels.ensure(prod);
    opening.catch(() => {});
    await macrotask();

    canvas.panels[0].panel.dispose();
    canvas.openAcquire();
    await expect(opening).rejects.toThrow(/closed before/);
    await macrotask();

    expect(canvas.holds.get(PROD)?.hold.release).toHaveBeenCalledOnce();
    expect(canvas.claimSaving).not.toHaveBeenCalled();
    expect(canvas.engine.serve).not.toHaveBeenCalled();
    expect(canvas.canvasPanels.roots()).toEqual([]);
  });
});

describe('an ensure while VS Code resolves the editor', () => {
  test('waits for that resolve and opens nothing, settling with its panel', async () => {
    const canvas = setup({ pendingAcquire: true });
    const { restored, resolving } = await restoring(canvas);

    const ensured = canvas.canvasPanels.ensure(prod);
    await macrotask();
    canvas.openAcquire();
    const made = await ensured;
    await resolving;

    expect(canvas.api.commands.executeCommand).not.toHaveBeenCalled();
    expect(made.panel).toBe(restored.panel);
    expect(canvas.canvasPanels.roots()).toEqual([prod]);
  });

  test('a failed resolve rejects the waiting ensure, and the next ensure opens again', async () => {
    const canvas = setup({ pendingAcquire: true, serveFails: [new Error('no')] });
    const { resolving } = await restoring(canvas);
    const ensured = canvas.canvasPanels.ensure(prod);
    canvas.openAcquire();
    await expect(ensured).rejects.toThrow('no');
    await resolving;

    await canvas.canvasPanels.ensure(prod);
    expect(canvas.api.commands.executeCommand).toHaveBeenCalledOnce();
  });

  test('nothing waits once the tab is closed: the next ensure opens a new panel', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    canvas.panels[0].panel.dispose();
    await macrotask();

    await canvas.canvasPanels.ensure(prod);

    expect(canvas.api.commands.executeCommand).toHaveBeenCalledTimes(2);
    expect(canvas.canvasPanels.roots()).toEqual([prod]);
  });
});

describe('a save that meets new edits', () => {
  // VS Code keeps the document dirty from a change event until the save it
  // asked for has resolved, and clears it a macrotask later, whatever came
  // meanwhile.
  test('an edit during a slow save leaves the document dirty once VS Code has cleared it', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const [document] = canvas.documents;
    const made = canvas.holds.get(PROD)!;
    unsaved(canvas, true, 'w1');
    expect(canvas.editors.isDirty(document)).toBe(true);
    made.save.mockImplementation(async () => {
      await macrotask();
      unsaved(canvas, false);
      unsaved(canvas, true, 'w2');
    });

    await canvas.editors.save(document);

    expect(canvas.editors.isDirty(document)).toBe(true);
  });

  test('an edit that lands between the save resolving and VS Code clearing the document leaves it dirty', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const [document] = canvas.documents;
    const made = canvas.holds.get(PROD)!;
    unsaved(canvas, true, 'w1');
    made.save.mockImplementation(async () => {
      unsaved(canvas, false);
    });

    const saving = canvas.editors.save(document);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    unsaved(canvas, true, 'w2');
    await saving;

    expect(canvas.editors.isDirty(document)).toBe(true);
  });

  test('a saved session stays clean, and a later edit marks it', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const [document] = canvas.documents;
    unsaved(canvas, true);
    canvas.holds.get(PROD)?.save.mockImplementation(async () => {
      unsaved(canvas, false);
    });

    await canvas.editors.save(document);
    expect(canvas.editors.isDirty(document)).toBe(false);
    unsaved(canvas, true);
    expect(canvas.editors.isDirty(document)).toBe(true);
  });

  test('a tab that shows clean while the session is saved is not marked', async () => {
    const canvas = setup();
    const told = listening(canvas);
    await canvas.canvasPanels.ensure(prod);
    unsaved(canvas, true);
    canvas.holds.get(PROD)?.save.mockImplementation(async () => {
      unsaved(canvas, false);
    });
    await canvas.editors.save(canvas.documents[0]);

    expect(told).toHaveLength(1);
  });

  test('a revert that VS Code clears leaves an unsaved session dirty', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    unsaved(canvas, true, 'w1');
    draws(canvas, 'w1');
    // The engine discards what the page drew, and another holder edits again.
    canvas.holds.get(PROD)?.apply.mockImplementation(async () => {
      unsaved(canvas, false);
      unsaved(canvas, true, 'w2');
      return { success: true, errors: [], created: [], ties: [] };
    });

    await canvas.editors.revert(canvas.documents[0]);

    expect(canvas.editors.isDirty(canvas.documents[0])).toBe(true);
  });

  test('the frame that says the session is saved while a revert runs does not save the document', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    unsaved(canvas, true);
    draws(canvas, 'working');
    canvas.holds.get(PROD)?.apply.mockImplementation(async () => {
      unsaved(canvas, false);
      return { success: true, errors: [], created: [], ties: [] };
    });

    await canvas.editors.revert(canvas.documents[0]);

    expect(canvas.api.workspace.save).not.toHaveBeenCalled();
  });

  test('a save a clear asks for writes nothing when an edit came since the saved frame', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const made = canvas.holds.get(PROD)!;
    unsaved(canvas, true, 'w1');
    // VS Code's save of the document, asked for by the clear, reaches the
    // provider after another edit was queued.
    canvas.api.workspace.save.mockImplementation(async (at) => {
      unsaved(canvas, true, 'w2');
      await canvas.provider().saveCustomDocument(canvas.documents[0], undefined as never);
      return at;
    });

    unsaved(canvas, false);
    await macrotask();

    expect(made.save).not.toHaveBeenCalled();
  });

  test('a save of the developer’s that arrives after the clear’s own while it is under way writes the edit', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const made = canvas.holds.get(PROD)!;
    unsaved(canvas, true, 'w1');
    canvas.api.workspace.save.mockImplementation(async (at) => {
      unsaved(canvas, true, 'w2');
      const provider = canvas.provider();
      const clears = provider.saveCustomDocument(canvas.documents[0], undefined as never);
      const developers = provider.saveCustomDocument(canvas.documents[0], undefined as never);
      await Promise.all([clears, developers]);
      return at;
    });

    unsaved(canvas, false);
    await macrotask();

    expect(made.save).toHaveBeenCalledOnce();
  });

  test('a save of the user’s own while no clear is under way writes the edit', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const made = canvas.holds.get(PROD)!;
    unsaved(canvas, true, 'w2');

    await canvas.provider().saveCustomDocument(canvas.documents[0], undefined as never);

    expect(made.save).toHaveBeenCalledOnce();
  });

  test('overlapping clears each take only their own token: an edit that lands between them is not written', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    const made = canvas.holds.get(PROD)!;
    const provider = canvas.provider();
    const save = async () => {
      await provider.saveCustomDocument(canvas.documents[0], undefined as never);
    };
    let endFirst!: () => void;
    let startSecond!: () => void;
    canvas.api.workspace.save
      .mockImplementationOnce(async (at) => {
        // The first clear's save arrives and is the first's own, then its
        // workspace.save stays pending.
        await save();
        await new Promise<void>((resolve) => {
          endFirst = resolve;
        });
        return at;
      })
      .mockImplementationOnce(async (at) => {
        // The second clear's save arrives later than the first clear ends.
        await new Promise<void>((resolve) => {
          startSecond = resolve;
        });
        await save();
        return at;
      });

    made.publish(frame({ unsaved: true, workingDigest: 'w1' }));
    made.publish(frame({ unsaved: false, workingDigest: 's1' }));
    await macrotask();
    made.publish(frame({ unsaved: true, workingDigest: 'w2' }));
    made.publish(frame({ unsaved: false, workingDigest: 's2' }));
    await macrotask();
    // An edit lands, then the first clear ends and the second's save arrives.
    made.publish(frame({ unsaved: true, workingDigest: 'w3' }));
    endFirst();
    await macrotask();
    startSecond();
    await macrotask();

    expect(made.save).not.toHaveBeenCalled();
  });

  test('a Don’t Save whose Discard the engine refuses tells the developer, and declines the digest the session holds', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);
    unsaved(canvas, true, 'w1');
    draws(canvas, 'w1');
    // Another holder edited since the page drew.
    unsaved(canvas, true, 'w2');
    canvas.holds.get(PROD)?.apply.mockRejectedValueOnce(
      new ConnectError('failed_precondition', 'the working state changed', {
        reason: Reason.REASON_STALE_WORKING_STATE,
        api_code: '',
        request_id: '',
      }),
    );

    await expect(canvas.editors.revert(canvas.documents[0])).rejects.toThrow(/not discarded/);
    canvas.panels[0].panel.dispose();
    await macrotask();

    expect(canvas.api.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('were not discarded'),
    );
    expect(canvas.released).toHaveBeenCalledExactlyOnceWith('w2');
  });

  test('the keeper’s save of the claim is the document’s own', async () => {
    const canvas = setup();
    await canvas.canvasPanels.ensure(prod);

    await canvas.claimedSave.current?.();

    expect(canvas.api.workspace.save).toHaveBeenCalledOnce();
    expect(canvas.api.workspace.save.mock.calls[0][0].toString()).toBe(
      canvas.documents[0].uri.toString(),
    );
  });
});

describe('a canvas whose first page is being served', () => {
  test('a save VS Code asks for meanwhile is the editor’s, not a no-op', async () => {
    const canvas = setup({ unsaved: true });
    let finish!: () => void;
    canvas.engine.serve.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return vi.fn();
    });
    const ensured = canvas.canvasPanels.ensure(prod);
    await macrotask();

    const saving = canvas.editors.save(canvas.documents[0]);
    await macrotask();
    expect(canvas.holds.get(PROD)?.save).not.toHaveBeenCalled();
    finish();
    await saving;
    await ensured;

    expect(canvas.holds.get(PROD)?.save).toHaveBeenCalledOnce();
  });
});

describe('an ensure that VS Code answers without opening an editor', () => {
  test('rejects, and the next ensure opens again', async () => {
    const canvas = setup();
    canvas.api.commands.executeCommand.mockImplementationOnce(async () => {});

    await expect(canvas.canvasPanels.ensure(prod)).rejects.toThrow(
      'VS Code did not open the canvas of infra/prod.',
    );
    await canvas.canvasPanels.ensure(prod);

    expect(canvas.canvasPanels.roots()).toEqual([prod]);
  });
});

describe('a canvas closed while its page is first served', () => {
  test('unserves the bridge, leaves the closed webview alone, and releases the hold', async () => {
    const canvas = setup();
    let finish!: () => void;
    canvas.engine.serve.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return vi.fn(() => {
        canvas.events.push('unserve');
      });
    });
    const ensured = canvas.canvasPanels.ensure(prod);
    ensured.catch(() => {});
    await macrotask();

    canvas.panels[0].panel.dispose();
    finish();
    await expect(ensured).rejects.toThrow(/closed before/);
    await macrotask();

    expect(canvas.events).toContain('unserve');
    expect(canvas.holds.get(PROD)?.hold.release).toHaveBeenCalledOnce();
    expect(canvas.canvasPanels.roots()).toEqual([]);
  });
});
