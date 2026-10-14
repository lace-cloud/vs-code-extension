import type { CanvasSource, SourceEnd } from '@lace-cloud/canvas/engine';
import type { MessageBridge } from '@lace-cloud/proto';
import { describe, expect, test, vi } from 'vitest';
import type { RootHold } from '../../engine/root-sessions';
import { folder, uri } from '../../roots/__tests__/fake-uri';
import type { AuthoringRoot } from '../../roots/authoring-roots';
import { createRootState } from '../../state/root-state';
import { createCanvasPanels } from '../canvas-panels';

const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };
const other: AuthoringRoot = { folder: repo, relative: 'infra/other' };

const frame = (over: Partial<CanvasSource> = {}): CanvasSource =>
  ({ unsaved: false, sourceRefused: false, ...over }) as CanvasSource;

// A hold whose session frames and renewals the test drives.
function fakeHold(root: string) {
  const frames = new Set<(s: CanvasSource) => void>();
  const renewals = new Set<() => void>();
  const release = vi.fn(async () => {});
  const hold = {
    root,
    sessionId: 'session',
    ports: {
      source: {
        subscribe: (on: (s: CanvasSource) => void, _end: (e: SourceEnd) => void) => {
          frames.add(on);
          on(frame());
          return () => frames.delete(on);
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
    publish: (s: CanvasSource) => {
      for (const on of [...frames]) on(s);
    },
    renew: () => {
      for (const listener of [...renewals]) listener();
    },
  };
}

type Listener = (m: unknown) => void;

// A panel as VS Code makes one: once disposed it no longer hands out its
// webview, and its webview delivers nothing posted to it.
function fakePanel() {
  const listeners = new Set<Listener>();
  const posted: unknown[] = [];
  let disposed = false;
  let onDispose = () => {};
  let onViewState = () => {};
  const webview = {
    html: '',
    cspSource: 'vscode-webview://csp',
    asWebviewUri: (u: { path: string }) => `webview://${u.path}`,
    postMessage: async (message: unknown) => {
      if (disposed) return false;
      posted.push(message);
      return true;
    },
    onDidReceiveMessage: (listener: Listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  const panel = {
    title: '',
    active: false,
    visible: true,
    reveal: vi.fn(),
    dispose: () => {
      disposed = true;
      onDispose();
    },
    onDidDispose: (listener: () => void) => {
      onDispose = listener;
      return { dispose: () => {} };
    },
    onDidChangeViewState: (listener: () => void) => {
      onViewState = listener;
      return { dispose: () => {} };
    },
    get webview() {
      if (disposed) throw new Error('Webview is disposed');
      return webview;
    },
  };
  return {
    panel,
    posted,
    disposed: () => disposed,
    // What the page sends.
    receive: (message: unknown) => {
      for (const listener of [...listeners]) listener(message);
    },
    activate: () => {
      panel.active = true;
      onViewState();
    },
  };
}

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
    // The workspace's folders.
    folders?: AuthoringRoot['folder'][];
    // What the engine's first serves fail with, in turn.
    serveFails?: Error[];
  } = {},
) {
  const panels: ReturnType<typeof fakePanel>[] = [];
  const holds = new Map<string, ReturnType<typeof fakeHold>>();
  const served: { bridge: MessageBridge; dispose: ReturnType<typeof vi.fn> }[] = [];
  const events: string[] = [];
  const reports: { what: string; error: unknown }[] = [];
  const api = {
    window: {
      createWebviewPanel: vi.fn((_type, title, showOptions) => {
        events.push(`create:${title}:${showOptions.preserveFocus}`);
        const made = fakePanel();
        made.panel.title = title;
        panels.push(made);
        return made.panel;
      }),
      showInformationMessage: vi.fn(async () => undefined),
      showWarningMessage: vi.fn(async () => undefined),
      showErrorMessage: vi.fn(
        async (_text: string, ..._labels: string[]): Promise<string | undefined> => undefined,
      ),
      showTextDocument: vi.fn(async () => {}),
    },
    workspace: {
      workspaceFolders: options.folders,
      openTextDocument: vi.fn(async (opened: { path?: string }) => {
        if (opened.path?.endsWith('/missing.tf')) {
          throw new Error(`cannot open file://${opened.path}`);
        }
        return { opened };
      }),
    },
    ViewColumn: { Active: -1, Beside: -2 },
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
      events.push(`acquire:${root}`);
      const made = fakeHold(root);
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
  const offers = {
    signIn: vi.fn(),
    selectOrganization: vi.fn(),
    selectTeam: vi.fn(),
    openPortal: vi.fn(),
    install: vi.fn(),
    openRecord: vi.fn(),
  };
  const validate = vi.fn(async () => {});
  const generated = vi.fn(async () => {});
  const canvasPanels = createCanvasPanels({
    api: api as never,
    extensionUri: uri('/ext'),
    engine,
    rootSessions,
    rootState,
    confirm,
    pageFocus,
    offers,
    validate,
    generated,
    report: (what, error) => reports.push({ what, error }),
  });
  return {
    api,
    canvasPanels,
    panels,
    holds,
    served,
    events,
    reports,
    storage,
    confirm,
    rootState,
    pageFocus,
    offers,
    validate,
    generated,
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ensure', () => {
  test('holds the session at panel creation, before the page boots, and resolves once the hold exists', async () => {
    const { canvasPanels, events, holds, panels } = setup();
    const made = await canvasPanels.ensure(prod);

    expect(events).toEqual(['acquire:/work/repo/infra/prod', 'create:infra/prod:false', 'serve']);
    expect(made.hold).toBe(holds.get('/work/repo/infra/prod')?.hold);
    expect(panels[0].panel.webview.html).toContain('canvas-webview.js');
    expect(panels[0].panel.webview.html).toContain("script-src 'nonce-");
  });

  test('two ensure calls give one panel; the second reveals it', async () => {
    const { canvasPanels, panels, api } = setup();
    const [a, b] = await Promise.all([canvasPanels.ensure(prod), canvasPanels.ensure(prod)]);
    const c = await canvasPanels.ensure(prod, { preserveFocus: true });

    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(api.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panels[0].panel.reveal).toHaveBeenCalledWith(undefined, true);
  });

  test('with preserveFocus the panel is created without taking focus', async () => {
    const { canvasPanels, events } = setup();
    await canvasPanels.ensure(prod, { preserveFocus: true });
    expect(events).toContain('create:infra/prod:true');
  });

  test('in a workspace of several folders the title names the folder first', async () => {
    const second = folder('/work/api', 1);
    const { canvasPanels, events } = setup({ folders: [repo, second] });
    await canvasPanels.ensure(prod);
    await canvasPanels.ensure({ folder: second, relative: 'infra/prod' });
    await canvasPanels.ensure({ folder: second, relative: '' });
    expect(events.filter((event) => event.startsWith('create:'))).toEqual([
      'create:repo/infra/prod:false',
      'create:api/infra/prod:false',
      'create:api:false',
    ]);
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
    await settled();
    expect(panels[0].disposed()).toBe(true);
    expect(holds.get('/work/repo/infra/prod')?.hold.release).toHaveBeenCalledOnce();
    expect(pageFocus).toHaveBeenCalledWith('session', false);

    const made = await canvasPanels.ensure(prod);
    expect(panels).toHaveLength(2);
    expect(made.panel).toBe(panels[1].panel);
    expect(made.hold.release).not.toHaveBeenCalled();
  });

  test('a refused acquire rejects and creates no panel', async () => {
    const { api } = setup();
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
      offers: {} as never,
      validate: vi.fn(),
      generated: vi.fn(),
      report: vi.fn(),
    });
    await expect(failing.ensure(prod)).rejects.toBe(refused);
    expect(api.window.createWebviewPanel).not.toHaveBeenCalled();
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
    await settled();
    expect(page.posted).toEqual([
      {
        ch: 'host',
        frame: {
          kind: 'reply',
          id: '1',
          response: { root: '/work/repo/infra/prod', arrangement: { saved: 1 } },
        },
      },
    ]);
  });

  test('an arrangement notice is kept per root; unsaved marks the title; notify shows a message; confirm asks', async () => {
    const { canvasPanels, panels, rootState, api, confirm } = setup();
    await canvasPanels.ensure(prod);
    const page = panels[0];
    const notice = (n: unknown) =>
      page.receive({ ch: 'host', frame: { kind: 'notice', notice: n } });

    notice({ op: 'arrangement', value: { a: {} } });
    await settled();
    expect(rootState.arrangement(prod)).toEqual({ a: {} });

    notice({ op: 'unsaved', value: true });
    expect(page.panel.title).toBe('infra/prod ●');
    notice({ op: 'unsaved', value: false });
    expect(page.panel.title).toBe('infra/prod');

    notice({ op: 'notify', level: 'error', text: 'broke' });
    notice({ op: 'notify', level: 'info', text: 'done' });
    expect(api.window.showErrorMessage).toHaveBeenCalledWith('broke');
    expect(api.window.showInformationMessage).toHaveBeenCalledWith('done');

    page.receive({
      ch: 'host',
      frame: { kind: 'call', id: '2', name: 'confirm', request: { text: 'sure?', typed: 'x' } },
    });
    await settled();
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
    await settled();
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
    await settled();
    expect(api.window.showTextDocument).toHaveBeenLastCalledWith(expect.anything(), {
      viewColumn: -2,
      selection: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
    });

    call('5', { file: 'missing.tf', line: 1 });
    await settled();
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
    api.window.showErrorMessage.mockImplementation(async (text) =>
      text.startsWith('Error: 1 construct') ? 'Validate' : 'Open Portal',
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
    await settled();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'Error: 1 construct could not be converted',
      'Validate',
    );
    expect(validate).toHaveBeenCalledWith(prod);

    notice({
      op: 'notify',
      level: 'error',
      text: 'no team',
      failure: { reason: 'no_team', message: 'no team', url: 'https://portal/teams/new' },
    });
    await settled();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'no team',
      'Select Team',
      'Open Portal',
    );
    expect(offers.openPortal).toHaveBeenCalledWith({
      kind: 'openPortal',
      url: 'https://portal/teams/new',
    });
  });

  test("the canvas's own Generate ends with the notice Lace: Generate shows, for the panel's root", async () => {
    const { canvasPanels, panels, generated } = setup();
    await canvasPanels.ensure(prod);
    panels[0].receive({
      ch: 'host',
      frame: { kind: 'notice', notice: { op: 'generated', written: ['main.tf', 'outputs.tf'] } },
    });
    await settled();
    expect(generated).toHaveBeenCalledWith(prod, ['main.tf', 'outputs.tf']);
  });

  test('an observer that fails is reported, and the next notice still lands', async () => {
    const { canvasPanels, panels, storage, reports } = setup();
    storage.update.mockRejectedValueOnce(new Error('storage'));
    await canvasPanels.ensure(prod);
    const page = panels[0];

    page.receive({
      ch: 'host',
      frame: { kind: 'notice', notice: { op: 'arrangement', value: {} } },
    });
    await settled();
    page.receive({ ch: 'host', frame: { kind: 'notice', notice: { op: 'unsaved', value: true } } });

    expect(reports.map((r) => String(r.error))).toEqual(['Error: storage']);
    expect(page.panel.title).toBe('infra/prod ●');
  });
});

describe('the stack, the tick and the focus', () => {
  const boot = { ch: 'host', frame: { kind: 'call', id: '1', name: 'boot', request: {} } };

  test('the page boots with the stack picked for its root', async () => {
    const { canvasPanels, panels, rootState } = setup();
    await rootState.pickStack(prod, { id: 'stk_1', slug: 'prod' });
    await canvasPanels.ensure(prod);
    panels[0].receive(boot);
    await settled();
    expect(panels[0].posted).toEqual([
      {
        ch: 'host',
        frame: {
          kind: 'reply',
          id: '1',
          response: {
            root: '/work/repo/infra/prod',
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
    await settled();
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

    holds.get('/work/repo/infra/prod')?.renew();
    await settled();

    expect(events).toEqual(['unserve', 'serve']);
    expect(served[0].dispose).toHaveBeenCalledTimes(1);
    expect(panels[0].panel.webview.html).not.toBe(before);
  });
});

describe('closing the tab', () => {
  test('disposes the bridge, then releases the hold', async () => {
    const { canvasPanels, panels, holds, events } = setup();
    await canvasPanels.ensure(prod);
    const hold = holds.get('/work/repo/infra/prod')!;
    hold.hold.release.mockImplementation(async () => {
      events.push('release');
    });
    events.length = 0;

    panels[0].panel.dispose();
    await settled();

    expect(events).toEqual(['unserve', 'release']);
    // The root has no panel now: the next ensure creates one.
    await canvasPanels.ensure(prod);
    expect(panels).toHaveLength(2);
  });

  test('the engine’s answers to the page after the tab closed go nowhere', async () => {
    const { canvasPanels, panels, served } = setup();
    await canvasPanels.ensure(prod);
    panels[0].panel.dispose();
    await settled();

    const status = { id: 1, status: { code: 1, message: 'cancelled' } };
    expect(() => served[0].bridge.post(status as never)).not.toThrow();
    expect(panels[0].posted).toEqual([]);
  });
});
