import { EventEmitter } from 'node:events';
import {
  type ActionContribution,
  CORE_COMMAND_ACTIONS,
  CommandExitError,
  type CommandFailure,
  type CommandRun,
  defineCommand,
  type RunCtx,
} from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import { createRunnerHost, type FailureAnswer, type Form } from '../runner-host';
import { fakeCommands, refused } from './fake-commands';

const action = (id: string) => {
  const found = CORE_COMMAND_ACTIONS.find((a) => a.id === id);
  if (!found) throw new Error(`no core action ${id}`);
  return found;
};
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const STACK = { id: 'stk_1', slug: 'prod' };
// What `stack scan` renders for a scan it triggered and did not wait on.
const SCAN_TRIGGERED = { stack: STACK, triggered: true, reason: null, settled: null };
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
  error: null,
};

// A notice the window showed: what the presenter was told, and the package
// actions that answer its failure.
type Shown = {
  level: string;
  text: string;
  failure?: CommandFailure;
  // The `RunCtx` of the run the notice is about.
  ctx?: RunCtx;
  answers: readonly FailureAnswer[];
};

function host(scripts: Parameters<typeof fakeCommands>[0], confirmed = true) {
  const window = { commands: fakeCommands(scripts) };
  const lines: [string, CommandRun][] = [];
  const shown: Shown[] = [];
  const confirm = vi.fn(async () => confirmed);
  const notify = vi.fn();
  // Each form the answerer was handed, with the run it is for.
  const forms: { form: Form; action: string; ctx: RunCtx }[] = [];
  const runners = createRunnerHost({
    commands: async () => window.commands.port,
    presenter: ({ noticed }) => ({
      notify: (...said) => {
        notify(...said);
        const [level, text, failure] = said;
        const run = noticed();
        shown.push({
          level,
          text,
          failure,
          ctx: run?.ctx,
          answers: failure && run ? run.answers(failure) : [],
        });
      },
      confirm,
    }),
    answerer: (form, run) => forms.push({ form, action: run.action.id, ctx: run.ctx }),
    onRunLog: (line, run) => lines.push([line, run]),
  });
  return { window, runners, lines, presenter: { notify, confirm }, shown, forms };
}

// Whether `ended` has resolved by now.
async function hasEnded(ended: Promise<void>): Promise<boolean> {
  let done = false;
  void ended.then(() => {
    done = true;
  });
  await settled();
  return done;
}

const STATE = '/home/dev/pulled.tfstate';
const IMPORTED = {
  stack: STACK,
  changed: true,
  written: ['main.tf'],
  removed: [],
  lock: { path: '/repo/infra', lockfile: '/repo/infra/.terraform.lock.hcl', providers: [] },
  diagnostics: [],
  importBlocks: 2,
  importResiduals: [],
  validate: {
    root: '/repo/infra',
    treeHash: 'h',
    verdict: 'already-lace-style',
    residuals: [],
    exitClass: 'ok',
    diagnostics: [],
  },
};
const RESIDUALS = [{ address: 'aws_s3_bucket.logs', type: 'aws_s3_bucket', reason: 'no id' }];
const RESIDUAL_FAILURE: CommandFailure = {
  reason: 'import_residual',
  message: '1 resource has no import id',
  importResiduals: RESIDUALS,
};

describe('the runner host', () => {
  test("runs a binding over the RunCtx it is given: the binding's arguments, every log line in order", async () => {
    const { window, runners, lines } = host({
      'stack apply': {
        documents: [
          { type: 'log', text: 'Preview Advisory:' },
          { type: 'log', text: '' },
          { type: 'log', text: '' },
          { type: 'stage', name: 'plan' },
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

  test("each tick is told with the run the runner's tick names: its command and the RunCtx it was started with, however runs interleave", async () => {
    const { window, runners } = host({ 'stack scan': { held: true } });
    const ticked: CommandRun[] = [];
    runners.onDidTick((run) => ticked.push(run));
    const prod = { root: '/repo/prod', stack: STACK };
    const staging = { root: '/repo/staging', stack: { id: 'stk_2', slug: 'staging' } };

    await runners.run(action('scan'), prod);
    await runners.run(action('scan'), staging);
    const [prodScan, stagingScan] = window.commands.held;
    stagingScan.finish([SCAN_TRIGGERED]);
    await settled();
    prodScan.finish([SCAN_TRIGGERED]);
    await settled();

    expect(ticked.map((run) => [run.path, run.ctx.root])).toEqual([
      ['stack scan', '/repo/staging'],
      ['stack scan', '/repo/prod'],
    ]);
    expect(ticked[0].ctx).toBe(staging);
    expect(ticked[1].ctx).toBe(prod);
  });

  test("a tick is told with the run the runner's tick names, though it fires outside the run's async context", async () => {
    // An emitter made outside every run: its listener runs in the context of
    // whoever emits, as a frame arriving over a bridge does.
    const outside = new EventEmitter();
    const scanSettledOutside: ActionContribution = {
      id: 'scan-settled-outside',
      label: 'Scan',
      placement: 'toolbar',
      requiredPorts: ['commands'],
      binding: defineCommand<'stack scan'>({
        kind: 'command',
        path: 'stack scan',
        args: (ctx) => ({ stack: ctx.stack?.id }),
        result: {
          kind: 'notify',
          consume: (rt) => {
            outside.once('settled', () => rt.tick());
          },
        },
      }),
    };
    const { runners } = host({ 'stack scan': { documents: [SCAN_TRIGGERED] } });
    const ticked: CommandRun[] = [];
    runners.onDidTick((run) => ticked.push(run));
    const prod = { root: '/repo/prod', stack: STACK };

    await runners.run(scanSettledOutside, prod);
    await settled();
    expect(ticked).toEqual([]);
    outside.emit('settled');

    expect(ticked.map((run) => [run.path, run.ctx])).toEqual([['stack scan', prod]]);
    expect(ticked[0].ctx).toBe(prod);
  });

  test('one store for the window: an apply of one root is refused while one runs anywhere', async () => {
    const { window, runners, presenter } = host({ 'stack apply': { held: true } });
    await runners.run(action('apply'), { root: '/repo/a', stack: STACK });
    await runners.run(action('apply'), { root: '/repo/b', stack: { id: 'stk_2', slug: 'b' } });
    expect(window.commands.invoked).toHaveLength(1);
    expect(presenter.notify).toHaveBeenCalledWith('warn', 'A run is in progress');
  });

  test('a restarted engine is a new port: the runner is built again, the store kept, and its ticks told', async () => {
    const { window, runners } = host({ 'stack apply': { documents: [RESULT] } });
    const ticked: (string | undefined)[] = [];
    runners.onDidTick((run) => ticked.push(run.ctx.root));
    await runners.run(action('apply'), { root: '/repo/infra', stack: STACK });
    await settled();
    const store = runners.store;
    const before = window.commands;

    window.commands = fakeCommands({ 'stack apply': { documents: [RESULT] } });
    await runners.run(action('apply'), { root: '/repo/next', stack: STACK });
    await settled();
    expect(before.invoked).toHaveLength(1);
    expect(window.commands.invoked).toHaveLength(1);
    expect(runners.store).toBe(store);
    // An apply ticks at its start and at its settle.
    expect(ticked).toEqual(['/repo/infra', '/repo/infra', '/repo/next', '/repo/next']);
  });

  test('the store it hands out marks a command running from its start to its end, however it ends', async () => {
    const { window, runners } = host({ 'stack scan': { held: true } });
    const running = () =>
      [...runners.store.getSnapshot().running].map(([on, { path }]) => [on, path]);

    await runners.run(action('scan'), { stack: STACK });
    await runners.run(action('scan'), { stack: { id: 'stk_2', slug: 'qa' } });
    expect(running()).toEqual([
      ['stack:stk_1', 'stack scan'],
      ['stack:stk_2', 'stack scan'],
    ]);

    window.commands.held[0].finish([SCAN_TRIGGERED]);
    window.commands.held[1].finish([], new CommandExitError(1, 'Error: no\n'));
    await settled();
    expect(running()).toEqual([]);
  });

  test('cancel is the explicit cancel of the running slot', async () => {
    const { window, runners } = host({ 'stack apply': { held: true } });
    await runners.run(action('apply'), { root: '/repo/infra', stack: STACK });
    await runners.cancel('run');
    expect(window.commands.held[0].cancelled).toBe(1);
  });
});

// The stack `stack create` renders.
const CREATED = {
  id: 'stk_9',
  orgId: 'org_1',
  teamId: 'team_1',
  connectionId: 'conn_1',
  slug: 'prod',
  name: 'Prod',
  description: null,
  source: { kind: 'git' as const, repoUrl: 'https://github.com/acme/repo', path: 'infra' },
  stateSerial: 0,
  stateLineage: null,
  stateVersion: null,
  stateLastWrittenAt: null,
  lastAppliedRunId: null,
  lastDriftScanAt: null,
  lastDriftStatus: null,
  lastDriftCount: 0,
  lastDriftStale: false,
  lastDriftConfirmedAt: null,
  lastDriftUndeterminedReason: null,
  chaosLockedByRunId: null,
  chaosLockedAt: null,
  createdBy: 'usr_1',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  archivedAt: null,
  connection: null,
  createdByName: null,
  lastApply: null,
};

describe("a run's form", () => {
  test('is handed to the answerer with the run it is for; its submit starts the command with the values, as part of that run', async () => {
    const { window, runners, forms, presenter } = host({
      'stack create': { documents: [CREATED] },
    });
    const ticked: RunCtx[] = [];
    runners.onDidTick((run) => ticked.push(run.ctx));
    const ctx = { root: '/repo/infra' };

    await runners.run(action('create'), ctx);
    expect(forms.map(({ action, ctx, form }) => [action, ctx, form.missing])).toEqual([
      ['create', ctx, ['slug', 'connection']],
    ]);
    expect(window.commands.invoked).toEqual([]);

    forms[0].form.submit({ slug: 'prod', connection: 'conn_1' });
    await settled();
    expect(window.commands.invoked).toEqual([
      {
        cwd: '/repo/infra',
        path: 'stack create',
        args: { source: '/repo/infra', slug: 'prod', connection: 'conn_1' },
      },
    ]);
    expect(presenter.notify).toHaveBeenCalledWith('info', 'Created stack prod');
    expect(ticked).toEqual([ctx]);
  });

  test('cancelled, runs nothing', async () => {
    const { window, runners, forms } = host({ 'stack create': { documents: [CREATED] } });
    await runners.run(action('create'), { root: '/repo/infra' });
    forms[0].form.cancel();
    await settled();
    expect(window.commands.invoked).toEqual([]);
  });

  test('superseded by a newer form, submits and cancels nothing when its prompts settle', async () => {
    const { window, runners, forms } = host({ 'stack create': { documents: [CREATED] } });
    await runners.run(action('create'), { root: '/repo/a' });
    await runners.run(action('create'), { root: '/repo/b' });
    const [first, second] = forms;

    first.form.submit({ slug: 'a', connection: 'conn_1' });
    first.form.cancel();
    second.form.submit({ slug: 'b', connection: 'conn_1' });
    await settled();
    expect(window.commands.invoked.map((call) => call.args)).toEqual([
      { source: '/repo/b', slug: 'b', connection: 'conn_1' },
    ]);
  });
});

describe("a run's end", () => {
  test('comes once every invocation it started has ended', async () => {
    const { window, runners } = host({ 'stack scan': { held: true } });
    const { ended } = await runners.run(action('scan'), { stack: STACK });
    expect(await hasEnded(ended)).toBe(false);

    window.commands.held[0].finish([SCAN_TRIGGERED]);
    expect(await hasEnded(ended)).toBe(true);
  });

  test('comes at once for a run the runner refuses', async () => {
    const { window, runners, presenter } = host({ 'stack import': { documents: [IMPORTED] } });
    const { ended } = await runners.run(action('import'), { root: '/repo/infra' });
    expect(presenter.notify).toHaveBeenCalledWith(
      'warn',
      'Import existing resources needs a stack',
    );
    expect(await hasEnded(ended)).toBe(true);
    expect(window.commands.invoked).toEqual([]);
  });

  test('comes when its form is cancelled', async () => {
    const { runners, forms } = host({ 'stack create': { documents: [CREATED] } });
    const { ended } = await runners.run(action('create'), { root: '/repo/infra' });
    expect(await hasEnded(ended)).toBe(false);

    forms[0].form.cancel();
    expect(await hasEnded(ended)).toBe(true);
  });

  test('comes when its form is superseded by a newer one', async () => {
    const { runners } = host({ 'stack create': { documents: [CREATED] } });
    const first = await runners.run(action('create'), { root: '/repo/a' });
    const second = await runners.run(action('create'), { root: '/repo/b' });
    expect(await hasEnded(first.ended)).toBe(true);
    expect(await hasEnded(second.ended)).toBe(false);
  });

  test('after a submit, comes once the command it started has ended', async () => {
    const { window, runners, forms } = host({ 'stack create': { held: true } });
    const { ended } = await runners.run(action('create'), { root: '/repo/infra' });
    forms[0].form.submit({ slug: 'prod', connection: 'conn_1' });
    expect(await hasEnded(ended)).toBe(false);

    window.commands.held[0].finish([CREATED]);
    expect(await hasEnded(ended)).toBe(true);
  });

  // An apply that leaves its stack to the host's form and writes its result
  // to the run slot, saying nothing through the presenter.
  const applyAsked: ActionContribution = {
    id: 'apply-asked',
    label: 'Apply',
    placement: 'toolbar',
    requiredPorts: ['commands'],
    binding: defineCommand<'stack apply'>({
      kind: 'command',
      path: 'stack apply',
      args: () => ({}),
      result: { kind: 'run', consume: (rt, e) => rt.write('run', rt.token, e) },
    }),
  };

  test('after a submit, comes once the command it started has ended, whatever the command says', async () => {
    const { window, runners, forms, presenter } = host({ 'stack apply': { held: true } });
    const { ended } = await runners.run(applyAsked, {});
    forms[0].form.submit({ stack: 'stk_1' });
    expect(await hasEnded(ended)).toBe(false);

    window.commands.held[0].finish([RESULT]);
    expect(await hasEnded(ended)).toBe(true);
    expect(presenter.notify).not.toHaveBeenCalled();
  });

  test('after a submit, comes when the runner refuses to start the command', async () => {
    const { window, runners, forms, presenter } = host({ 'stack apply': { held: true } });
    const { ended } = await runners.run(applyAsked, {});
    // An apply started while the form was open holds the run slot.
    await runners.run(action('apply'), { root: '/repo/a', stack: STACK });
    forms[0].form.submit({ stack: 'stk_1' });

    expect(await hasEnded(ended)).toBe(true);
    expect(presenter.notify).toHaveBeenCalledWith('warn', 'A run is in progress');
    expect(window.commands.invoked).toHaveLength(1);
  });

  test('after a submit, comes when the confirmation is answered no, and nothing runs', async () => {
    const { window, runners, forms, presenter } = host(
      { 'stack import': { documents: [IMPORTED] } },
      false,
    );
    const { ended } = await runners.run(
      action('import-partial'),
      { root: '/repo/infra', stack: STACK },
      { failure: RESIDUAL_FAILURE },
    );
    forms[0].form.submit({ state: STATE });
    expect(await hasEnded(ended)).toBe(true);
    expect(presenter.confirm).toHaveBeenCalledOnce();
    expect(window.commands.invoked).toEqual([]);
  });
});

describe('a failure a package action answers', () => {
  test("is offered with it, which runs over the failed run's context and reuses the statefile that run was given", async () => {
    const { window, runners, forms, shown, presenter } = host({
      'stack import': (args) =>
        args.allowPartial
          ? { documents: [{ ...IMPORTED, importResiduals: RESIDUALS }] }
          : refused(RESIDUAL_FAILURE),
    });
    const ctx = { root: '/repo/infra', stack: STACK };
    await runners.run(action('import'), ctx);
    forms[0].form.submit({ state: STATE });
    await settled();

    const [failed] = shown.filter((notice) => notice.failure !== undefined);
    expect(failed).toMatchObject({ level: 'error', failure: RESIDUAL_FAILURE });
    const [answer] = failed.answers;
    expect(answer).toEqual({
      action: action('import-partial'),
      ctx,
      target: { failure: RESIDUAL_FAILURE },
    });
    expect(answer.ctx).toBe(ctx);

    await runners.run(answer.action, answer.ctx, answer.target);
    await settled();
    expect(forms).toHaveLength(1);
    expect(presenter.confirm).toHaveBeenCalledWith({
      text: "Import into prod without adopting aws_s3_bucket.logs? Lace writes no import block for them, so the stack's apply creates them anew beside the live ones.",
    });
    expect(window.commands.invoked).toEqual([
      { cwd: '/repo/infra', path: 'stack import', args: { stack: 'stk_1', state: STATE } },
      {
        cwd: '/repo/infra',
        path: 'stack import',
        args: { stack: 'stk_1', allowPartial: true, state: STATE },
      },
    ]);
  });

  test('a run over another context asks for its statefile again', async () => {
    const { runners, forms } = host({ 'stack import': refused(RESIDUAL_FAILURE) });
    await runners.run(action('import'), { root: '/repo/infra', stack: STACK });
    forms[0].form.submit({ state: STATE });
    await settled();

    await runners.run(action('import'), { root: '/repo/infra', stack: STACK });
    expect(forms.map(({ form }) => form.missing)).toEqual([['state'], ['state']]);
  });

  test('is told with the RunCtx of the run it is about, the one the run was started with', async () => {
    const { runners, forms, shown } = host({ 'stack import': refused(RESIDUAL_FAILURE) });
    const ctx = { root: '/repo/infra', stack: STACK };
    await runners.run(action('import'), ctx);
    forms[0].form.submit({ state: STATE });
    await settled();
    expect(shown).toHaveLength(1);
    expect(shown[0].ctx).toBe(ctx);
  });

  test('a failure no package action answers offers none', async () => {
    const { runners, shown } = host({
      'stack scan': refused({ reason: 'unauthenticated', message: 'sign in' }),
    });
    await runners.run(action('scan'), { stack: STACK });
    await settled();
    expect(shown.map(({ failure, answers }) => [failure?.reason, answers])).toEqual([
      ['unauthenticated', []],
    ]);
  });
});
