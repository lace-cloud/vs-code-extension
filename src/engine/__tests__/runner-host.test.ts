import { CORE_COMMAND_ACTIONS, CommandExitError, type CommandRun } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import { createRunnerHost } from '../runner-host';
import { fakeCommands } from './fake-commands';

const action = (id: string) => {
  const found = CORE_COMMAND_ACTIONS.find((a) => a.id === id);
  if (!found) throw new Error(`no core action ${id}`);
  return found;
};
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const STACK = { id: 'stk_1', slug: 'prod' };
const RESULT = {
  type: 'result',
  run: {
    id: 'run_1',
    stackId: 'stk_1',
    orgId: 'org_1',
    teamId: 'team_1',
    kind: 'apply',
    status: 'apply_succeeded',
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
    planResourceChange: 0,
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
  },
  summary: { resourceAdd: 1, resourceChange: 0, resourceDestroy: 0 },
  workspaceDir: '/cache',
  error: null,
};

function host(scripts: Parameters<typeof fakeCommands>[0]) {
  const window = { commands: fakeCommands(scripts) };
  const lines: [string, CommandRun][] = [];
  const presenter = { notify: vi.fn(), confirm: vi.fn(async () => true) };
  const runners = createRunnerHost({
    commands: async () => window.commands.port,
    presenter,
    onRunLog: (line, run) => lines.push([line, run]),
  });
  return { window, runners, lines, presenter };
}

describe('the runner host', () => {
  test("runs a binding over the RunCtx it is given: the binding's arguments, every log line in order", async () => {
    const { window, runners, lines } = host({
      'stack apply': {
        documents: [
          { type: 'log', text: 'Preview Advisory:' },
          { type: 'log', text: '' },
          { type: 'log', text: '' },
          { type: 'phase', name: 'plan' },
          { type: 'log', text: 'Still creating...' },
          { type: 'log', text: 'Still creating...' },
          RESULT,
        ],
      },
    });
    await runners.run(action('apply'), { root: '/repo/infra', stack: STACK });
    await settled();

    expect(window.commands.invoked.map((c) => [c.path, c.args])).toEqual([
      ['stack apply', { stack: 'stk_1' }],
    ]);
    expect(lines.map(([line]) => line)).toEqual([
      'Preview Advisory:',
      '',
      '',
      'Still creating...',
      'Still creating...',
    ]);
    for (const [, run] of lines) {
      expect(run.ctx).toEqual({ root: '/repo/infra', stack: STACK });
      expect(run.path).toBe('stack apply');
    }
    expect(runners.store.getSnapshot().run?.outcome).toEqual({ kind: 'succeeded' });
  });

  test('each tick is told with the RunCtx of the run whose binding ticked it, however runs interleave', async () => {
    const { window, runners } = host({ 'stack scan': { held: true } });
    const ticked: (string | undefined)[] = [];
    runners.onDidTick((ctx) => ticked.push(ctx.root));
    const prod = { root: '/repo/prod', stack: STACK };
    const staging = { root: '/repo/staging', stack: { id: 'stk_2', slug: 'staging' } };

    await runners.run(action('scan'), prod);
    await runners.run(action('scan'), staging);
    const [prodScan, stagingScan] = window.commands.held;
    stagingScan.finish([{ triggered: true, reason: null, settled: null }]);
    await settled();
    prodScan.finish([{ triggered: true, reason: null, settled: null }]);
    await settled();

    expect(ticked).toEqual(['/repo/staging', '/repo/prod']);
  });

  test('one store for the window: an apply of one root is refused while one runs anywhere', async () => {
    const { window, runners, presenter } = host({ 'stack apply': { held: true } });
    await runners.run(action('apply'), { root: '/repo/a', stack: STACK });
    await runners.run(action('apply'), { root: '/repo/b', stack: { id: 'stk_2', slug: 'b' } });
    expect(window.commands.invoked).toHaveLength(1);
    expect(presenter.notify).toHaveBeenCalledWith('warn', 'A run is in progress');
  });

  test('a restarted engine is a new port: the runner is built again and the store kept', async () => {
    const { window, runners } = host({ 'stack apply': { documents: [RESULT] } });
    await runners.run(action('apply'), { root: '/repo/infra', stack: STACK });
    await settled();
    const store = runners.store;
    const before = window.commands;

    window.commands = fakeCommands({ 'stack apply': { documents: [RESULT] } });
    await runners.run(action('apply'), { root: '/repo/infra', stack: STACK });
    await settled();
    expect(before.invoked).toHaveLength(1);
    expect(window.commands.invoked).toHaveLength(1);
    expect(runners.store).toBe(store);
  });

  test('says when an invocation is under way, however it ends', async () => {
    const { window, runners } = host({
      'run logs': { held: true },
      'stack scan': { fails: new CommandExitError(1, 'Error: no') },
    });
    const busy: boolean[] = [];
    runners.onDidChangeBusy((b) => busy.push(b));

    await runners.run(action('follow-logs'), { stack: STACK }, { runId: 'run_1' });
    await runners.run(action('scan'), { stack: STACK });
    await settled();
    expect(busy).toEqual([true]);

    window.commands.held[0].finish([{ type: 'result', status: 'apply_succeeded' }]);
    await settled();
    expect(busy).toEqual([true, false]);
  });

  test('cancel is the explicit cancel of the running slot', async () => {
    const { window, runners } = host({ 'stack apply': { held: true } });
    await runners.run(action('apply'), { root: '/repo/infra', stack: STACK });
    await runners.cancel('run');
    expect(window.commands.held[0].cancelled).toBe(1);
  });
});
