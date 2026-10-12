// The engine for this window: one `lace engine` process, started on demand
// and reached two ways — a webview's bridge is served over it, and the
// extension host calls it through a bridge of its own, so both sides hold the
// same typed mapping.
//
// The process is `ServerManager`'s. It is spawned with a stdin pipe the
// manager holds, and the engine exits when that pipe reaches end of file, so
// an extension host that dies takes its engine, its sessions and their locks
// with it.
import { type BridgeEngineCaller, bridgeCaller } from '@lace-cloud/canvas/engine';
import {
  EngineProtocolMismatchError,
  type EngineTransport,
  ServerManager,
  type ServerState,
  serveEngineBridge,
} from '@lace-cloud/host';
import type { BridgeRequest, BridgeResponse, MessageBridge } from '@lace-cloud/proto';
import type * as vscode from 'vscode';
import { registerCommands } from '../vscode/commands';

export type EngineState = ServerState;

// What the developer is told about an engine that did not come up. One
// whose handshake names another protocol is a Lace CLI of another release,
// and which side to update follows from which side is behind.
function startFailure(binaryPath: string, cause: unknown): string {
  if (cause instanceof EngineProtocolMismatchError) {
    return cause.engineTooOld
      ? `The Lace CLI at ${binaryPath} is too old for this extension: it speaks engine protocol ${cause.engineProtocol} and this extension needs ${cause.requiredProtocol}. Update the Lace CLI, or point the setting lace.binaryPath at a newer one.`
      : `The Lace CLI at ${binaryPath} is newer than this extension: it speaks engine protocol ${cause.engineProtocol} and this extension speaks ${cause.requiredProtocol}. Update the Lace extension.`;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return `The Lace engine did not start from ${binaryPath} (the setting lace.binaryPath): ${message}`;
}

// The engine did not come up: the binary is missing or not executable, it
// exited before its handshake, its handshake named another protocol, or it
// refused `Initialize`.
export class EngineStartError extends Error {
  constructor(
    readonly binaryPath: string,
    override readonly cause: unknown,
  ) {
    super(startFailure(binaryPath, cause));
  }
}

// The engine stopped while a caller was waiting for it to run.
export class EngineStoppedError extends Error {
  constructor() {
    super('The Lace engine stopped.');
  }
}

export type Engine = {
  state: () => EngineState;
  // `listener` is called with every state the engine enters.
  onState: (listener: (state: EngineState) => void) => () => void;
  // The extension host's own caller over the running engine. Starts the
  // engine when it is not running.
  caller: () => Promise<BridgeEngineCaller>;
  // The same caller once the engine runs, without starting it: what waits
  // for a restart that `lace.autoRestart` or the developer decides. Given
  // the caller of an engine that stopped answering, the one over the engine
  // that runs next: a stream ends with the engine's death before its manager
  // has seen the exit.
  whenRunning: (other?: BridgeEngineCaller) => Promise<BridgeEngineCaller>;
  // Serves a webview's bridge over the running engine, starting it when it
  // is not running, until the returned function is called.
  serve: (bridge: MessageBridge) => Promise<() => void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
};

// What the engine reads from its process manager; `ServerManager` is one.
export type EngineManager = {
  readonly currentState: ServerState;
  readonly transport: EngineTransport | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  on: (event: 'state', listener: (state: ServerState) => void) => unknown;
};

export type EngineSettings = {
  binaryPath: () => string;
  autoRestart: () => boolean;
};

// The one reader of the `lace.*` engine settings.
export function engineSettings(
  workspace: Pick<typeof vscode.workspace, 'getConfiguration'>,
): EngineSettings {
  const lace = () => workspace.getConfiguration('lace');
  return {
    binaryPath: () => lace().get<string>('binaryPath', '/usr/local/bin/lace'),
    autoRestart: () => lace().get<boolean>('autoRestart', true),
  };
}

export function engineManager(
  settings: EngineSettings,
  log: (line: string) => void,
): EngineManager {
  return new ServerManager({
    log,
    getBinaryPath: settings.binaryPath,
    getAutoRestart: settings.autoRestart,
  });
}

// Two ends of one in-process bridge: what one end posts, the other's
// listeners receive.
function bridgePair(): { host: MessageBridge; caller: MessageBridge } {
  type Frame = BridgeRequest | BridgeResponse;
  const end = (mine: Set<(m: unknown) => void>, theirs: Set<(m: unknown) => void>) => ({
    post: (frame: Frame) => {
      for (const listener of [...theirs]) listener(frame);
    },
    onMessage: (listener: (m: unknown) => void) => {
      mine.add(listener);
      return () => mine.delete(listener);
    },
  });
  const host = new Set<(m: unknown) => void>();
  const caller = new Set<(m: unknown) => void>();
  return { host: end(host, caller), caller: end(caller, host) };
}

export function createEngine(manager: EngineManager, settings: EngineSettings): Engine {
  const listeners = new Set<(state: EngineState) => void>();
  manager.on('state', (state) => {
    for (const listener of [...listeners]) listener(state);
  });

  const onState: Engine['onState'] = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  // The extension host's bridge over one transport. A restarted engine is a
  // new transport, and gets a new bridge.
  let own: { transport: EngineTransport; caller: BridgeEngineCaller; dispose: () => void } | null =
    null;
  function ownCaller(transport: EngineTransport): BridgeEngineCaller {
    if (own?.transport !== transport) {
      own?.dispose();
      const pair = bridgePair();
      own = {
        transport,
        caller: bridgeCaller(pair.caller),
        dispose: serveEngineBridge(pair.host, transport),
      };
    }
    return own.caller;
  }

  const running = (): EngineTransport | null =>
    manager.currentState === 'running' ? manager.transport : null;

  // Resolves with the transport at the next `running`; with `orStopped`,
  // rejects at a state that says no start is under way.
  function nextRunning(orStopped: boolean): Promise<EngineTransport> {
    return new Promise((resolve, reject) => {
      const off = onState((state) => {
        const transport = running();
        if (transport) {
          off();
          resolve(transport);
        } else if (orStopped && state !== 'starting') {
          off();
          reject(new EngineStoppedError());
        }
      });
    });
  }

  let starting: Promise<void> | null = null;
  function start(): Promise<void> {
    starting ??= manager
      .start()
      .catch((cause) => {
        throw new EngineStartError(settings.binaryPath(), cause);
      })
      .finally(() => {
        starting = null;
      });
    return starting;
  }

  async function demand(): Promise<EngineTransport> {
    const before = running();
    if (before) return before;
    // A start the manager began itself (its restart after an exit) is under
    // way while the state is `starting`: `start` returns at once then, and
    // the state it settles in is the answer.
    const settled = nextRunning(true);
    settled.catch(() => {});
    await start();
    return running() ?? settled;
  }

  return {
    state: () => manager.currentState,
    onState,
    caller: async () => ownCaller(await demand()),
    whenRunning: async (other) => {
      const now = running();
      if (now && ownCaller(now) !== other) return ownCaller(now);
      return ownCaller(await nextRunning(false));
    },
    serve: async (bridge) => serveEngineBridge(bridge, await demand()),
    start,
    stop: async () => {
      await manager.stop();
      own?.dispose();
      own = null;
    },
    restart: async () => {
      await manager.stop();
      await start();
    },
  };
}

const STATUS_TEXT: Record<EngineState, string> = {
  stopped: 'Lace Engine: stopped',
  starting: 'Lace Engine: starting',
  running: 'Lace Engine: running',
  error: 'Lace Engine: error',
};

type ControlsApi = Parameters<typeof registerCommands>[0] & {
  window: Pick<typeof vscode.window, 'createStatusBarItem'>;
};

// The engine's status bar item and its palette commands.
export function engineControls(
  api: ControlsApi,
  engine: Engine,
  log: Pick<vscode.OutputChannel, 'show'>,
): vscode.Disposable {
  const status = api.window.createStatusBarItem();
  status.command = 'lace.openLogs';
  const show = (state: EngineState) => {
    status.text = STATUS_TEXT[state];
    status.show();
  };
  show(engine.state());
  const offState = engine.onState(show);

  const commands = registerCommands(api, {
    'lace.startEngine': () => engine.start(),
    'lace.stopEngine': () => engine.stop(),
    'lace.restartEngine': () => engine.restart(),
    'lace.openLogs': () => log.show(),
  });

  return {
    dispose() {
      offState();
      status.dispose();
      for (const command of commands) command.dispose();
    },
  };
}
