// The runner host: the window's one action runner, the only path a host
// surface runs a package binding through (the Stacks tree's rows, the stack
// commands of the palette, Create Stack, Import Existing Resources, and the
// package actions a failure's notice offers). The binding owns the
// arguments, the confirmation and the result; the host hands it a `RunCtx`
// naming the authoring root and the stack, answers the arguments it leaves
// to the host, and draws the store.
//
// The runner runs over the commands mapping's port for the developer's home
// and one result store for the window. A binding that declares the root
// runs in the `RunCtx`'s root, which the runner names as the invocation's
// working directory; any other runs in the home. A restarted engine is a
// new port: the next run builds the runner again over it, keeping the
// store. What is running is the store's to say, and the host keeps no count
// of its own: the Stacks view asks it whether any command is under way
// through the package's `commandUnderWay`, the one place that does.
//
// Each tick of the store (a run started or settled, a scan or a cancel done)
// is told with the command run the runner's own tick names
// (`ActionRunner.onDidTick`): its `RunCtx` says which root and stack the
// reads it made stale are about, so a surface refreshes that root. The
// runner built again over a restarted engine tells its ticks the same way.
//
// Each run is carried through everything the runner does for it in an
// async context (`AsyncLocalStorage`), which attributes to the run what
// names no run of its own:
//
// - A form, the arguments a binding leaves to the host: what the run's
//   `RunCtx` object was answered before is reused by argument name, and the
//   answerer asks the rest. The host keeps the one form the runner handed it
//   last: a form superseded by a newer one submits and cancels nothing when
//   its prompts settle. A submit runs in the run's context again.
// - The run's end: a run ends once nothing of it is pending, neither the
//   runner's call, nor its form, nor its start after a submit, nor an
//   invocation it started. From a submit the run is starting until it starts
//   its command or the runner declines it: a confirmation answered no, or a
//   refusal, which the runner always states (`presenter.notify`) and says
//   nothing else before a command starts. `run` resolves when the runner's
//   call does, with the run's end, which a trigger shows progress against.
// - A notice: the window's presenter is told the `RunCtx` of the run it is
//   about, so a notice of a failure offers the ways out of that run's root,
//   and, beside them, each package action placed on a failure's row whose
//   `answers` names the failure's reason, run over the failed run's own
//   `RunCtx` object, so it reuses what that run was answered. The runner's
//   own requirement check still gates it.
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type ActionContribution,
  type ActionRunner,
  type ActionRunnerOptions,
  type ActionTarget,
  answering,
  CORE_COMMAND_ACTIONS,
  type CommandFailure,
  type CommandRun,
  type CommandsPort,
  createActionRunner,
  createResultStore,
  type PendingForm,
  type PresenterPort,
  type ResultKind,
  type ResultStore,
  type RunCtx,
} from '@lace-cloud/canvas/engine';

// The arguments a run still needs, as the runner asks a host for them.
export type Form = NonNullable<PendingForm>;

// What answers a form: it asks for each argument `form.missing` names, in
// order, and submits the values, or cancels the form. `run` is the action,
// the `RunCtx` and the target of the run the form is for.
export type Answerer = (
  form: Form,
  run: { action: ActionContribution; ctx: RunCtx; target: ActionTarget },
) => void;

// A package action that answers a failure, to run over the failed run's
// `RunCtx` with the failure as its target.
export type FailureAnswer = { action: ActionContribution; ctx: RunCtx; target: ActionTarget };

// The run a notice is about: its `RunCtx`, and the package actions that
// answer a failure of it.
export type Noticed = {
  ctx: RunCtx;
  answers: (failure: CommandFailure) => readonly FailureAnswer[];
};

// The window's presenter for the runner, made with the runner's `run`, which
// runs an answer, and `noticed`, which names the run a notice is about while
// the presenter is told the notice, and none for a notice of no run.
export type RunnerPresenter = (runner: {
  run: RunnerHost['run'];
  noticed: () => Noticed | undefined;
}) => PresenterPort;

export type RunnerHost = {
  readonly store: ResultStore;
  // Resolves when the runner's call does, with the run's end.
  run: (
    action: ActionContribution,
    ctx: RunCtx,
    target?: ActionTarget,
  ) => Promise<{ ended: Promise<void> }>;
  // `listener` is called with the command run the runner's tick names, at
  // each tick of the store a binding made.
  onDidTick: (listener: (run: CommandRun) => void) => () => void;
  // The explicit user cancel of the `kind` slot's invocation.
  cancel: (kind: ResultKind) => Promise<void>;
  dispose: () => void;
};

export type RunnerHostOptions = {
  commands: () => Promise<CommandsPort>;
  presenter: RunnerPresenter;
  answerer: Answerer;
  onRunLog: NonNullable<ActionRunnerOptions['onRunLog']>;
};

type Built = { port: CommandsPort; runner: ActionRunner };

// The package's binding `id`.
export function binding(id: string): ActionContribution {
  const found = CORE_COMMAND_ACTIONS.find((action) => action.id === id);
  if (!found) throw new Error(`the canvas package carries no binding ${id}`);
  return found;
}

// One run the host started: its action, context and target, how much of it
// is pending (`starting` among it while set), and its end.
type Run = {
  readonly action: ActionContribution;
  readonly ctx: RunCtx;
  readonly target: ActionTarget;
  pending: number;
  starting: boolean;
  readonly end: () => void;
  readonly ended: Promise<void>;
};

function begun(action: ActionContribution, ctx: RunCtx, target: ActionTarget): Run {
  let end = () => {};
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  // The runner's call is pending from the start.
  return { action, ctx, target, pending: 1, starting: false, end, ended };
}

function hold(run: Run): void {
  run.pending += 1;
}

function release(run: Run): void {
  run.pending -= 1;
  if (run.pending === 0) run.end();
}

// The run's start after a submit settled: its command started, or the
// runner declined it.
function startSettled(run: Run): void {
  if (!run.starting) return;
  run.starting = false;
  release(run);
}

export function createRunnerHost(options: RunnerHostOptions): RunnerHost {
  const store = createResultStore();
  const tickListeners = new Set<(run: CommandRun) => void>();
  // The run whose binding is executing.
  const runContext = new AsyncLocalStorage<Run>();
  // What each `RunCtx` object was answered, by argument name.
  const answered = new WeakMap<RunCtx, Readonly<Record<string, unknown>>>();
  // The form the runner handed the host last, while its prompts may still
  // settle it, and the run it is for.
  let open: { form: Form; run: Run } | undefined;
  const ticked = (run: CommandRun) => {
    for (const listener of [...tickListeners]) listener(run);
  };
  let built: Built | undefined;

  // `port` with each invocation held by the run that started it, from its
  // start to the end of its events, however they end. The call reaches
  // `port` whole: the working directory the runner names for a
  // root-declaring binding included.
  const heldByRun = (port: CommandsPort): CommandsPort => ({
    available: () => port.available(),
    invoke(...call) {
      const run = runContext.getStore();
      const invocation = port.invoke(...call);
      if (!run) return invocation;
      hold(run);
      startSettled(run);
      const events = async function* () {
        try {
          yield* invocation.events;
        } finally {
          release(run);
        }
      };
      return { events: events(), cancel: () => invocation.cancel() };
    },
  });

  // A form the runner hands the host, or `null` once the one it handed is
  // submitted or cancelled. The form it supersedes is no longer pending.
  function formChanged(form: PendingForm): void {
    const superseded = open;
    open = undefined;
    if (superseded) release(superseded.run);
    if (form === null) return;
    const run = runContext.getStore();
    if (!run) {
      form.cancel();
      return;
    }
    const entry = { form, run };
    open = entry;
    hold(run);
    const kept = answered.get(run.ctx) ?? {};
    const submit = (values: Record<string, unknown>) => {
      if (open !== entry) return;
      open = undefined;
      answered.set(run.ctx, { ...answered.get(run.ctx), ...values });
      const given: Record<string, unknown> = { ...kept, ...values };
      // The form's hold is the start's now.
      run.starting = true;
      runContext.run(run, () =>
        form.submit(Object.fromEntries(form.missing.map((name) => [name, given[name]]))),
      );
    };
    const cancel = () => {
      if (open !== entry) return;
      open = undefined;
      release(run);
      form.cancel();
    };
    const missing = form.missing.filter((name) => !Object.hasOwn(kept, name));
    if (missing.length === 0) submit({});
    else
      options.answerer(
        { path: form.path, missing, submit, cancel },
        { action: run.action, ctx: run.ctx, target: run.target },
      );
  }

  // The window's presenter, told the run each notice is about: its
  // `RunCtx`, and the package actions that answer a failure of it, over
  // that `RunCtx`. A notice or a confirmation answered no settles a starting
  // run's start.
  const shown = options.presenter({
    run,
    noticed: () => {
      const noticed = runContext.getStore();
      if (!noticed) return undefined;
      return {
        ctx: noticed.ctx,
        answers: (failure) =>
          answering(CORE_COMMAND_ACTIONS, failure).map((action) => ({
            action,
            ctx: noticed.ctx,
            target: { failure },
          })),
      };
    },
  });
  const confirm = shown.confirm;
  const presenter: PresenterPort = {
    notify(...said) {
      const starting = runContext.getStore();
      if (starting) startSettled(starting);
      shown.notify(...said);
    },
    ...(confirm === undefined
      ? {}
      : {
          confirm: async (spec) => {
            const asking = runContext.getStore();
            const confirmed = await confirm(spec);
            if (!confirmed && asking) startSettled(asking);
            return confirmed;
          },
        }),
  };

  // The runner over the engine's port now, built again when the engine was
  // restarted; disposing the one it replaces stops that one's ticks.
  async function runner(): Promise<ActionRunner> {
    const port = await options.commands();
    if (built?.port !== port) {
      built?.runner.dispose();
      const made = createActionRunner({ commands: heldByRun(port), presenter }, store, {
        onRunLog: options.onRunLog,
        onPendingFormChange: formChanged,
      });
      made.onDidTick(ticked);
      built = { port, runner: made };
    }
    return built.runner;
  }

  async function run(
    action: ActionContribution,
    ctx: RunCtx,
    target: ActionTarget = {},
  ): Promise<{ ended: Promise<void> }> {
    const current = await runner();
    const started = begun(action, ctx, target);
    try {
      await runContext.run(started, () => current.run(action, ctx, target));
    } finally {
      release(started);
    }
    return { ended: started.ended };
  }

  return {
    store,
    run,
    onDidTick(listener) {
      tickListeners.add(listener);
      return () => tickListeners.delete(listener);
    },
    async cancel(kind) {
      await built?.runner.cancel(kind);
    },
    dispose() {
      built?.runner.dispose();
    },
  };
}
