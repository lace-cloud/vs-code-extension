import { describe, expect, test, vi } from 'vitest';
import { type FakeEngine, fakeEngine } from '../../engine/__tests__/fake-engine';
import { createRootSessions, type RootHold } from '../../engine/root-sessions';
import { folder } from '../../roots/__tests__/fake-uri';
import { type AuthoringRoot, type RootSources, rootPath } from '../../roots/authoring-roots';
import {
  PLACEMENT_API_REFUSALS,
  PLACEMENT_REFUSALS,
  type PlaceApi,
  placeModule,
} from '../place-module';

const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };
// A module as the registry names it: its version as the registry spells it.
const VPC = { author: 'acme', name: 'vpc', version: 'v2.0.0' };

const sources = (root: AuthoringRoot | undefined): RootSources => ({
  folders: () => [repo],
  activeCanvas: () => root,
  activeTerraformDirectory: () => undefined,
  terraformFiles: async () => [],
  pick: async () => undefined,
});

function setup(options: { root?: AuthoringRoot | null; answer?: string } = {}) {
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
      withProgress: vi.fn((_o: unknown, task: () => Promise<unknown>) => task()),
      setStatusBarMessage: vi.fn(),
    },
    commands: { executeCommand: vi.fn(async () => undefined) },
    ProgressLocation: { Notification: 15 },
  };
  const log = { appendLine: vi.fn(), show: vi.fn() };
  const placed = vi.fn(async () => {});
  const place = placeModule({
    api: api as unknown as PlaceApi,
    sources: sources(options.root === null ? undefined : (options.root ?? prod)),
    panels,
    rootSessions,
    log,
    placed,
  });
  const sent = (method: string) => engine.sent.filter((s) => s.method === method);
  return { engine, place, api, log, placed, panels, rootSessions, events, sent, panelHolds };
}

describe('placing a registry module', () => {
  test("holds the root's canvas first, applies one place_module, and the session stays open after", async () => {
    const { place, events, sent, engine, rootSessions, placed } = setup();
    await place(VPC);

    expect(events).toEqual(['ensure /work/repo/infra/prod true']);
    expect(sent('ApplyAction').map((s) => s.request.actions)).toEqual([[{ placeModule: VPC }]]);
    expect(sent('SessionClose')).toEqual([]);
    expect(engine.open()).toHaveLength(1);
    expect(rootSessions.held()).toMatchObject([{ root: '/work/repo/infra/prod', holders: 1 }]);
    expect(placed).toHaveBeenCalledWith(VPC);
  });

  test('ensures the canvas before the edit is sent', async () => {
    const { place, engine, panels } = setup();
    const ensured = panels.ensure.mock;
    await place(VPC);
    const firstApply = engine.sent.findIndex((s) => s.method === 'ApplyAction');
    const firstOpen = engine.sent.findIndex((s) => s.method === 'SessionOpen');
    expect(ensured.calls).toHaveLength(1);
    expect(firstOpen).toBeLessThan(firstApply);
  });

  test('with no root named, nothing is opened, and the notice says why', async () => {
    const { place, panels, sent, api } = setup({ root: null });
    await place(VPC);
    expect(panels.ensure).not.toHaveBeenCalled();
    expect(sent('SessionOpen')).toEqual([]);
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'No module to add acme/vpc v2.0.0 to: no directory under this workspace holds Terraform files. Start one with Lace: Open Canvas on its folder in the Explorer.',
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
    await place(VPC);
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      `Lace could not add acme/vpc v2.0.0 to infra/prod: ${why}.`,
      'Show Details',
    );
    expect(placed).not.toHaveBeenCalled();
  });

  test("Show Details writes the engine's message to the Output channel", async () => {
    const { place, engine, log } = setup({ answer: 'Show Details' });
    engine.refuse('ApplyAction', 'REASON_NOT_LACE_FORM', 'verdict: lossy');
    await place(VPC);
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
    await place(VPC);
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'Sign in to add acme/vpc v2.0.0 from the Lace registry.',
      'Sign In',
    );
    expect(api.commands.executeCommand).toHaveBeenCalledWith('lace.signIn');
  });

  test('a root the engine will not open is shown, and the call does not reject', async () => {
    const { place, engine, api } = setup();
    engine.refuse('SessionOpen', 'REASON_ROOT_LOCKED');
    await expect(place(VPC)).resolves.toBeUndefined();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'Lace could not add acme/vpc v2.0.0 to infra/prod: the engine refused it.',
      'Show Details',
    );
  });
});
