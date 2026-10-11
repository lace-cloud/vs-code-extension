// The runner host: the window's one action runner, the only path a host
// surface runs a package binding through (the Stacks tree's rows, the stack
// commands of the palette). The binding owns the arguments, the
// confirmation and the result; the host hands it a `RunCtx` naming the
// authoring root and the stack, and draws the store.
//
// The runner runs over the commands mapping's port for the developer's home
// and one result store for the window. A binding that declares the root
// runs in the `RunCtx`'s root, which the runner names as the invocation's
// working directory; any other runs in the home. A restarted engine is a
// new port: the next run builds the runner again over it, keeping the
// store. Every invocation the runner
// starts is counted, so a surface can show that one is under way.
//
// A tick of the store (a run started or settled, a scan or a cancel done)
// is told with the `RunCtx` of the run whose binding ticked it, so a
// surface refreshes the root that run was about. The store's tick names no
// run, and a binding ticks from the work it started, so the host runs each
// binding inside an async context carrying its `RunCtx` and reads that
// context when the store notifies.
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type ActionContribution,
  type ActionRunnerOptions,
  type ActionTarget,
  type CommandsPort,
  createActionRunner,
  createResultStore,
  type PresenterPort,
  type ResultKind,
  type ResultStore,
  type RunCtx,
} from '@lace-cloud/canvas/engine';

export type RunnerHost = {
  readonly store: ResultStore;
  run: (action: ActionContribution, ctx: RunCtx, target?: ActionTarget) => Promise<void>;
  // `listener` is called with the `RunCtx` of the run whose binding ticked
  // the store, at each tick.
  onDidTick: (listener: (ctx: RunCtx) => void) => () => void;
  // The explicit user cancel of the `kind` slot's invocation.
  cancel: (kind: ResultKind) => Promise<void>;
  // `listener` is called with true when the first invocation starts and
  // false when the last one ends.
  onDidChangeBusy: (listener: (busy: boolean) => void) => () => void;
  dispose: () => void;
};

export type RunnerHostOptions = {
  commands: () => Promise<CommandsPort>;
  presenter: PresenterPort;
  onRunLog: NonNullable<ActionRunnerOptions['onRunLog']>;
};

type Built = { port: CommandsPort; runner: ReturnType<typeof createActionRunner> };

export function createRunnerHost(options: RunnerHostOptions): RunnerHost {
  const store = createResultStore();
  const busyListeners = new Set<(busy: boolean) => void>();
  const tickListeners = new Set<(ctx: RunCtx) => void>();
  // The `RunCtx` of the run whose binding is executing.
  const runContext = new AsyncLocalStorage<RunCtx>();
  let seenTick = store.getTick();
  const offStore = store.subscribe(() => {
    const tick = store.getTick();
    if (tick === seenTick) return;
    seenTick = tick;
    const ctx = runContext.getStore();
    if (ctx) for (const listener of [...tickListeners]) listener(ctx);
  });
  let running = 0;
  let built: Built | undefined;

  const changed = (by: number) => {
    const was = running > 0;
    running += by;
    if (was !== running > 0) for (const listener of [...busyListeners]) listener(running > 0);
  };

  // `port` with each invocation counted from its start to the end of its
  // events, however they end. The call reaches `port` whole: the working
  // directory the runner names for a root-declaring binding included.
  const counted = (port: CommandsPort): CommandsPort => ({
    available: () => port.available(),
    invoke(...call) {
      const invocation = port.invoke(...call);
      changed(1);
      async function* events() {
        try {
          yield* invocation.events;
        } finally {
          changed(-1);
        }
      }
      return { events: events(), cancel: () => invocation.cancel() };
    },
  });

  async function runner(): Promise<Built['runner']> {
    const port = await options.commands();
    if (built?.port !== port) {
      built?.runner.dispose();
      built = {
        port,
        runner: createActionRunner(
          { commands: counted(port), presenter: options.presenter },
          store,
          { onRunLog: options.onRunLog },
        ),
      };
    }
    return built.runner;
  }

  return {
    store,
    async run(action, ctx, target = {}) {
      const built = await runner();
      await runContext.run(ctx, () => built.run(action, ctx, target));
    },
    onDidTick(listener) {
      tickListeners.add(listener);
      return () => tickListeners.delete(listener);
    },
    async cancel(kind) {
      await built?.runner.cancel(kind);
    },
    onDidChangeBusy(listener) {
      busyListeners.add(listener);
      return () => busyListeners.delete(listener);
    },
    dispose() {
      offStore();
      built?.runner.dispose();
    },
  };
}
