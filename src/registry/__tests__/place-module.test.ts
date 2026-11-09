import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { fakeCommands, refused, type Script } from '../../engine/__tests__/fake-commands';
import { type FakeEngine, fakeEngine, settled } from '../../engine/__tests__/fake-engine';
import { createRootSessions, type RootHold } from '../../engine/root-sessions';
import { record } from '../../protocol/__tests__/registry-fixtures';
import { folder, fsPath } from '../../roots/__tests__/fake-uri';
import { type AuthoringRoot, rootPath, type StartingSources } from '../../roots/authoring-roots';
import {
  PLACEMENT_API_REFUSALS,
  PLACEMENT_REFUSALS,
  type PlaceApi,
  placeModule,
} from '../place-module';
import { registryReads } from '../registry-reads';

const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };
// A module as the registry names it: its version as the registry spells it.
const VPC = { author: 'acme', name: 'vpc', version: 'v2.0.0' };

// The roots placement can name: the active canvas's, the canvases open, or
// in a workspace that holds no Terraform the folder the module starts in.
const sources = (
  root: AuthoringRoot | undefined,
  folders: readonly vscode.WorkspaceFolder[],
  open: readonly AuthoringRoot[],
): StartingSources => ({
  folders: () => folders,
  activeCanvas: () => root,
  openCanvases: () => open,
  activeTerraformDirectory: () => undefined,
  terraformFiles: async () => [],
  pick: async () => undefined,
  start: async () => undefined,
});

function setup(
  options: {
    root?: AuthoringRoot | null;
    answer?: string;
    folders?: readonly vscode.WorkspaceFolder[];
    // The canvases open in the window, focused or not.
    open?: readonly AuthoringRoot[];
    // What `registry get` answers when the placement reads the module.
    get?: Script;
  } = {},
) {
  const engine: FakeEngine = fakeEngine();
  const reports: unknown[] = [];
  const rootSessions = createRootSessions({
    engine: { caller: async () => engine.caller, whenRunning: async () => engine.caller },
    report: (_what, error) => reports.push(error),
  });
  const events: string[] = [];
  // The canvas panel: it holds the root's session from its creation on.
  const panelHolds: RootHold[] = [];
  const panels = {
    ensure: vi.fn(async (root: AuthoringRoot, ensureOptions?: { preserveFocus?: boolean }) => {
      events.push(`ensure ${rootPath(root)} ${ensureOptions?.preserveFocus}`);
      const hold = await rootSessions.acquire(rootPath(root));
      panelHolds.push(hold);
      return { root, hold, panel: {} } as never;
    }),
  };
  const api = {
    window: {
      showInformationMessage: vi.fn(async () => undefined),
      showErrorMessage: vi.fn(async () => options.answer),
      showWarningMessage: vi.fn(async (_text: string): Promise<undefined> => undefined),
      withProgress: vi.fn((_o: unknown, task: () => Promise<unknown>) => task()),
      setStatusBarMessage: vi.fn(),
    },
    commands: { executeCommand: vi.fn(async () => undefined) },
    ProgressLocation: { Notification: 15 },
  };
  const log = { appendLine: vi.fn(), show: vi.fn() };
  const placed = vi.fn(async () => {});
  const commands = fakeCommands({ 'registry get': options.get ?? { documents: [record()] } });
  const place = placeModule({
    api: api as unknown as PlaceApi,
    sources: sources(
      options.root === null ? undefined : (options.root ?? prod),
      options.folders ?? [repo],
      options.open ?? (options.root === null ? [] : [options.root ?? prod]),
    ),
    panels,
    rootSessions,
    reads: registryReads(commands.commands),
    log,
    placed,
  });
  const sent = (method: string) => engine.sent.filter((s) => s.method === method);
  const reads = () => commands.invoked.filter((run) => run.path === 'registry get');
  return {
    engine,
    place,
    api,
    log,
    placed,
    panels,
    rootSessions,
    events,
    sent,
    panelHolds,
    reads,
    held: commands.held,
  };
}

describe('placing a registry module', () => {
  test("holds the root's canvas first, applies one place_module, and the session stays open after", async () => {
    const { place, events, sent, engine, rootSessions, placed } = setup();
    await place(VPC, 'published');

    expect(events).toEqual([`ensure ${fsPath('/work/repo/infra/prod')} true`]);
    expect(sent('ApplyAction').map((s) => s.request.actions)).toEqual([[{ placeModule: VPC }]]);
    expect(sent('SessionClose')).toEqual([]);
    expect(engine.open()).toHaveLength(1);
    expect(rootSessions.held()).toMatchObject([
      { root: fsPath('/work/repo/infra/prod'), holders: 1 },
    ]);
    expect(placed).toHaveBeenCalledWith(VPC);
  });

  test('says in the status bar which version it added, and that a deprecated one is', async () => {
    const { place, api, sent, placed } = setup({
      get: { documents: [record({ latest: { version: 'v1.0.0', status: 'published' } })] },
    });
    await place(VPC, 'published');
    expect(api.window.setStatusBarMessage).toHaveBeenLastCalledWith(
      'Lace: added acme/vpc v2.0.0 to infra/prod',
      5000,
    );
    const deprecated = { ...VPC, version: 'v1.0.0' };
    await place(deprecated, 'deprecated');
    expect(api.window.setStatusBarMessage).toHaveBeenLastCalledWith(
      'Lace: added acme/vpc v1.0.0 (Deprecated) to infra/prod',
      5000,
    );
    expect(sent('ApplyAction').map((s) => s.request.actions)).toEqual([
      [{ placeModule: VPC }],
      [{ placeModule: deprecated }],
    ]);
    expect(placed).toHaveBeenLastCalledWith(deprecated);
  });

  describe('a deprecated version', () => {
    const OLD = { ...VPC, version: 'v1.0.0' };
    const latest = (version: string, status: string) => ({
      documents: [record({ latest: { version, status } })],
    });
    const bar = (api: ReturnType<typeof setup>['api']) =>
      api.window.setStatusBarMessage.mock.lastCall?.[0];
    const warned = (api: ReturnType<typeof setup>['api']) =>
      api.window.showWarningMessage.mock.calls.map(([text]) => text);
    const ADDED = 'Lace: added acme/vpc v1.0.0 (Deprecated) to infra/prod';

    test('names the newest published version in a warning notice, keeps the status bar to the added line, and still places it', async () => {
      const { place, api, sent, reads } = setup({ get: latest('v2.0.0', 'published') });
      await place(OLD, 'deprecated');
      expect(warned(api)).toEqual([
        `${ADDED}. v2.0.0 is the newest published version; place that one instead.`,
      ]);
      expect(api.window.showWarningMessage.mock.calls[0]).toHaveLength(1);
      expect(api.window.setStatusBarMessage.mock.calls).toEqual([[ADDED, 5000]]);
      expect(sent('ApplyAction').map((s) => s.request.actions)).toEqual([[{ placeModule: OLD }]]);
      expect(reads()).toHaveLength(1);
    });

    test.each([
      ['nothing is published', 'v2.0.0', 'deprecated'],
      ['the newest published is the version placed', 'v1.0.0', 'published'],
    ])('suggests nothing when %s', async (_case, version, status) => {
      const { place, api } = setup({ get: latest(version, status) });
      await place(OLD, 'deprecated');
      expect(bar(api)).toBe(ADDED);
      expect(warned(api)).toEqual([]);
    });

    test('uses the latest the caller already read, and reads nothing', async () => {
      const { place, api, reads } = setup();
      await place(OLD, 'deprecated', { version: 'v3.0.0', status: 'published' });
      expect(warned(api)).toEqual([
        `${ADDED}. v3.0.0 is the newest published version; place that one instead.`,
      ]);
      expect(reads()).toEqual([]);
    });

    const UNREAD = `${ADDED}, but Lace could not read the newest published version; see the Lace Output channel.`;

    test('is placed and says the newest published version could not be read when the read fails, and the failure is logged', async () => {
      const { place, api, placed, log, sent } = setup({
        get: refused({ reason: 'unauthenticated', message: 'offline' }),
      });
      await place(OLD, 'deprecated');
      expect(warned(api)).toEqual([UNREAD]);
      expect(api.window.setStatusBarMessage.mock.calls).toEqual([[ADDED, 5000]]);
      expect(sent('ApplyAction')).toHaveLength(1);
      expect(placed).toHaveBeenCalledWith(OLD);
      expect(log.appendLine).toHaveBeenCalledWith(expect.stringContaining('offline'));
      expect(log.appendLine).toHaveBeenCalledTimes(1);
    });

    test('is placed and says the newest published version could not be read when the read throws, and the error is logged', async () => {
      const { place, api, placed, log } = setup({
        get: { fails: new Error('the engine stopped') },
      });
      await place(OLD, 'deprecated');
      expect(warned(api)).toEqual([UNREAD]);
      expect(api.window.setStatusBarMessage.mock.calls).toEqual([[ADDED, 5000]]);
      expect(placed).toHaveBeenCalledWith(OLD);
      expect(log.appendLine).toHaveBeenCalledWith(expect.stringContaining('the engine stopped'));
      expect(log.appendLine).toHaveBeenCalledTimes(1);
    });

    test.each([
      ['returns failed', refused({ reason: 'unauthenticated', message: 'offline' }), 'offline'],
      ['throws', { fails: new Error('the engine stopped') } as Script, 'the engine stopped'],
    ])('logs one line for the latest-version read that %s', async (_case, get, why) => {
      const { place, log } = setup({ get });
      await place(OLD, 'deprecated');
      expect(log.appendLine.mock.calls).toEqual([
        [`Reading the latest version of acme/vpc: ${why}`],
      ]);
    });

    test('is added, recorded and released before the registry is asked for the newest published version', async () => {
      const { place, api, placed, rootSessions, held } = setup({ get: { held: true } });
      const done = place(OLD, 'deprecated');
      await settled();

      expect(held).toHaveLength(1);
      expect(placed).toHaveBeenCalledWith(OLD);
      expect(rootSessions.held()).toMatchObject([{ holders: 1 }]);
      expect(api.window.setStatusBarMessage.mock.calls).toEqual([
        ['Lace: added acme/vpc v1.0.0 (Deprecated) to infra/prod', 5000],
      ]);
      expect(api.window.showWarningMessage).not.toHaveBeenCalled();

      held[0].finish([record({ latest: { version: 'v2.0.0', status: 'published' } })]);
      await done;
      expect(warned(api)).toEqual([
        `${ADDED}. v2.0.0 is the newest published version; place that one instead.`,
      ]);
    });

    test('is not added when the engine answers the placement unsuccessful: the error alone is shown, and nothing more is read', async () => {
      const { place, api, engine, placed, reads } = setup({ get: latest('v2.0.0', 'published') });
      engine.rejectApply('no such input');
      await place(OLD, 'deprecated');

      expect(api.window.showErrorMessage).toHaveBeenCalledWith(
        'Lace could not add acme/vpc v1.0.0 (Deprecated) to infra/prod: no such input',
      );
      expect(api.window.setStatusBarMessage).not.toHaveBeenCalled();
      expect(api.window.showWarningMessage).not.toHaveBeenCalled();
      expect(placed).not.toHaveBeenCalled();
      expect(reads()).toEqual([]);
    });

    test('sets one status message when there is nothing to suggest', async () => {
      const { place, api } = setup({ get: latest('v2.0.0', 'deprecated') });
      await place(OLD, 'deprecated');
      expect(api.window.setStatusBarMessage.mock.calls).toEqual([
        ['Lace: added acme/vpc v1.0.0 (Deprecated) to infra/prod', 5000],
      ]);
    });

    test('warns for each deprecated placement, and a later placement does not replace the notice', async () => {
      const { place, api, held } = setup({ get: { held: true } });
      const first = place(OLD, 'deprecated');
      await settled();
      await place(VPC, 'published');
      held[0].finish([record({ latest: { version: 'v2.0.0', status: 'published' } })]);
      await first;

      expect(api.window.setStatusBarMessage.mock.calls.map(([text]) => text)).toEqual([
        ADDED,
        'Lace: added acme/vpc v2.0.0 to infra/prod',
      ]);
      expect(warned(api)).toEqual([
        `${ADDED}. v2.0.0 is the newest published version; place that one instead.`,
      ]);
    });

    test('a published version is placed with no notice', async () => {
      const { place, api } = setup();
      await place(VPC, 'published');
      expect(api.window.showWarningMessage).not.toHaveBeenCalled();
    });

    test('is a published version that is placed with no extra read', async () => {
      const { place, api, reads } = setup();
      await place(VPC, 'published');
      expect(bar(api)).toBe('Lace: added acme/vpc v2.0.0 to infra/prod');
      expect(reads()).toEqual([]);
    });
  });

  test('ensures the canvas before the edit is sent', async () => {
    const { place, engine, panels } = setup();
    const ensured = panels.ensure.mock;
    await place(VPC, 'published');
    const firstApply = engine.sent.findIndex((s) => s.method === 'ApplyAction');
    const firstOpen = engine.sent.findIndex((s) => s.method === 'SessionOpen');
    expect(ensured.calls).toHaveLength(1);
    expect(firstOpen).toBeLessThan(firstApply);
  });

  test('in a workspace that holds no Terraform, the module is placed on a new canvas of the workspace folder', async () => {
    const { place, events, sent, api, placed } = setup({ root: null });
    await place(VPC, 'published');
    expect(events).toEqual([`ensure ${fsPath('/work/repo')} true`]);
    expect(sent('ApplyAction').map((s) => s.request.actions)).toEqual([[{ placeModule: VPC }]]);
    expect(api.window.showInformationMessage).not.toHaveBeenCalled();
    expect(placed).toHaveBeenCalledWith(VPC);
  });

  test('in a workspace that holds no Terraform, an unfocused canvas open on a directory is where the module is placed', async () => {
    const { place, events, sent } = setup({
      root: null,
      open: [{ folder: repo, relative: 'infra/new' }],
    });
    await place(VPC, 'published');
    expect(events).toEqual([`ensure ${fsPath('/work/repo/infra/new')} true`]);
    expect(sent('ApplyAction').map((s) => s.request.actions)).toEqual([[{ placeModule: VPC }]]);
  });

  test('with no folder open, nothing is opened, and the notice says why', async () => {
    const { place, panels, sent, api } = setup({ root: null, folders: [] });
    await place(VPC, 'published');
    expect(panels.ensure).not.toHaveBeenCalled();
    expect(sent('SessionOpen')).toEqual([]);
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'No module to add acme/vpc v2.0.0 to: no folder is open. Open the folder that holds the module first.',
    );
  });

  test.each([
    ...Object.entries(PLACEMENT_REFUSALS).map(([reason, why]) => [
      reason,
      why,
      `REASON_${reason.toUpperCase()}`,
      undefined,
    ]),
    ...Object.entries(PLACEMENT_API_REFUSALS).map(([code, why]) => [
      code,
      why,
      'REASON_UNSPECIFIED',
      code,
    ]),
  ])('a refusal for %s names the module and says why', async (_name, why, reason, apiCode) => {
    const { place, engine, api, placed } = setup();
    engine.refuse('ApplyAction', String(reason), 'the engine says so', apiCode);
    await place(VPC, 'published');
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      `Lace could not add acme/vpc v2.0.0 to infra/prod: ${why}.`,
      'Show Details',
    );
    expect(api.window.showWarningMessage).not.toHaveBeenCalled();
    expect(placed).not.toHaveBeenCalled();
  });

  test("Show Details writes the engine's message to the Output channel", async () => {
    const { place, engine, log } = setup({ answer: 'Show Details' });
    engine.refuse('ApplyAction', 'REASON_NOT_LACE_FORM', 'verdict: lossy');
    await place(VPC, 'published');
    expect(log.appendLine).toHaveBeenCalledWith(expect.stringContaining('verdict: lossy'));
    expect(log.show).toHaveBeenCalled();
  });

  test('signed out is decided by the refusal’s code and offers Sign In', async () => {
    const { place, engine, api } = setup({ answer: 'Sign In' });
    engine.refuse(
      'ApplyAction',
      'REASON_UNSPECIFIED',
      'Authentication required',
      'unauthenticated',
    );
    await place(VPC, 'published');
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'Sign in to add acme/vpc v2.0.0 from the Lace registry.',
      'Sign In',
    );
    expect(api.commands.executeCommand).toHaveBeenCalledWith('lace.signIn');
  });

  test('a root the engine will not open is shown, and the call does not reject', async () => {
    const { place, engine, api } = setup();
    engine.refuse('SessionOpen', 'REASON_ROOT_LOCKED');
    await expect(place(VPC, 'published')).resolves.toBeUndefined();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'Lace could not add acme/vpc v2.0.0 to infra/prod: the engine refused it.',
      'Show Details',
    );
  });
});
