import type { BridgeEngineCaller } from '@lace-cloud/canvas/engine';
import {
  EngineProtocolMismatchError,
  EngineSpawnError,
  type EngineTransport,
  type ServerState,
} from '@lace-cloud/host';
import type { BridgeRequest, BridgeResponse } from '@lace-cloud/proto';
import { describe, expect, test, vi } from 'vitest';
import {
  createEngine,
  type EngineManager,
  EngineStartError,
  EngineStoppedError,
  engineControls,
  engineSettings,
} from '../engine';

// A transport that answers every unary call with its own name, so a test can
// tell which engine a call reached.
function fakeTransport(name: string): EngineTransport {
  return {
    client: {
      makeUnaryRequest(_path, _serialize, _deserialize, _argument, _metadata, callback) {
        callback(null, { server_version: name, command_paths: [] });
      },
      makeServerStreamRequest() {
        throw new Error('no stream in these tests');
      },
    },
    metadata: () => undefined as never,
  };
}

function fakeManager() {
  const listeners: ((state: ServerState) => void)[] = [];
  let engines = 0;
  const manager = {
    currentState: 'stopped' as ServerState,
    transport: null as EngineTransport | null,
    starts: 0,
    // What the next start does once `come` is called.
    failure: undefined as Error | undefined,
    come: () => {},
    on(_event: 'state', listener: (state: ServerState) => void) {
      listeners.push(listener);
    },
    enter(state: ServerState) {
      manager.currentState = state;
      for (const listener of [...listeners]) listener(state);
    },
    run() {
      engines += 1;
      manager.transport = fakeTransport(`engine${engines}`);
      manager.enter('running');
    },
    async start() {
      if (manager.currentState === 'running' || manager.currentState === 'starting') return;
      manager.starts += 1;
      manager.enter('starting');
      await new Promise<void>((resolve) => {
        manager.come = resolve;
      });
      if (manager.failure) {
        manager.enter('error');
        throw manager.failure;
      }
      manager.run();
    },
    async stop() {
      manager.transport = null;
      manager.enter('stopped');
    },
  };
  return manager satisfies EngineManager;
}

const settings = { binaryPath: () => '/opt/lace', autoRestart: () => true };
// The error a binary that could not be spawned rejects with, as Node's
// spawn reports `code`.
const spawnFailed = (code: string, binary: string) =>
  new EngineSpawnError(Object.assign(new Error(`spawn ${binary} ${code}`), { code }));
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const version = async (caller: BridgeEngineCaller) =>
  (await caller.unary('Initialize', {})).server_version;

describe('the engine starts on demand', () => {
  test('asking for a caller starts a stopped engine, once for every asker', async () => {
    const manager = fakeManager();
    const engine = createEngine(manager, settings);
    expect(manager.starts).toBe(0);

    const first = engine.caller();
    const second = engine.caller();
    await tick();
    manager.come();

    expect(await first).toBe(await second);
    expect(manager.starts).toBe(1);
    expect(await version(await first)).toBe('engine1');
    expect(await engine.caller()).toBe(await first);
    expect(manager.starts).toBe(1);
  });

  test('a start that fails rejects with where the binary was read from and why', async () => {
    const manager = fakeManager();
    const cause = spawnFailed('ENOENT', '/opt/lace');
    manager.failure = cause;
    const engine = createEngine(manager, settings);

    const asked = engine.caller().catch((error) => error);
    await tick();
    manager.come();
    const failure = await asked;

    expect(failure).toBeInstanceOf(EngineStartError);
    expect(failure.binaryPath).toBe('/opt/lace');
    expect(failure.cause).toBe(cause);
    expect(engine.state()).toBe('error');
  });

  // What a start that failed with `failure` says, the binary read from
  // `binaryPath`.
  const startSays = async (failure: Error, binaryPath = '/opt/lace') => {
    const manager = fakeManager();
    manager.failure = failure;
    const asked = createEngine(manager, { ...settings, binaryPath: () => binaryPath })
      .caller()
      .catch((error) => error.message);
    await tick();
    manager.come();
    return asked;
  };

  test('a binary that is not found names PATH and the setting', async () => {
    expect(await startSays(spawnFailed('ENOENT', 'lace'), 'lace')).toBe(
      'The Lace engine did not start from lace (the setting lace.binaryPath): Failed to spawn engine: spawn lace ENOENT. Install the Lace CLI so lace is on PATH, or set lace.binaryPath to the full path of its executable.',
    );
  });

  test('a .cmd or .bat the spawn refuses (EINVAL) names lace.exe for the setting', async () => {
    for (const shim of ['C:\\Users\\dev\\AppData\\Roaming\\npm\\lace.cmd', 'C:\\tools\\LACE.BAT']) {
      expect(await startSays(spawnFailed('EINVAL', shim), shim)).toBe(
        `The Lace engine did not start from ${shim} (the setting lace.binaryPath): Failed to spawn engine: spawn ${shim} EINVAL. Windows cannot start a .cmd or .bat file directly; point lace.binaryPath at lace.exe.`,
      );
    }
    // The remedy is the code and the binary's extension together.
    expect(await startSays(spawnFailed('EINVAL', '/opt/lace'))).toBe(
      'The Lace engine did not start from /opt/lace (the setting lace.binaryPath): Failed to spawn engine: spawn /opt/lace EINVAL.',
    );
    expect(
      await startSays(spawnFailed('EACCES', 'C:\\tools\\lace.cmd'), 'C:\\tools\\lace.cmd'),
    ).toBe(
      'The Lace engine did not start from C:\\tools\\lace.cmd (the setting lace.binaryPath): Failed to spawn engine: spawn C:\\tools\\lace.cmd EACCES.',
    );
  });

  test('any other failed start says what happened and where the binary was read from, and no remedy for a missing one', async () => {
    expect(await startSays(spawnFailed('EACCES', '/opt/lace'))).toBe(
      'The Lace engine did not start from /opt/lace (the setting lace.binaryPath): Failed to spawn engine: spawn /opt/lace EACCES.',
    );
    expect(await startSays(new Error('the engine exited before its handshake (code 1)'))).toBe(
      'The Lace engine did not start from /opt/lace (the setting lace.binaryPath): the engine exited before its handshake (code 1).',
    );
    // The remedy follows the spawn error's code, never a message's text.
    expect(await startSays(new Error('spawn /opt/lace ENOENT'))).toBe(
      'The Lace engine did not start from /opt/lace (the setting lace.binaryPath): spawn /opt/lace ENOENT.',
    );
  });

  test('an engine of another protocol names the side that is behind', async () => {
    const said = async (engineProtocol: string) => {
      const manager = fakeManager();
      manager.failure = new EngineProtocolMismatchError('0.16.0', engineProtocol, '2');
      const asked = createEngine(manager, settings)
        .caller()
        .catch((error) => error.message);
      await tick();
      manager.come();
      return asked;
    };
    expect(await said('1')).toBe(
      'The Lace CLI at /opt/lace is too old for this extension: it speaks engine protocol 1 and this extension needs 2. Update the Lace CLI, or point the setting lace.binaryPath at a newer one.',
    );
    expect(await said('3')).toBe(
      'The Lace CLI at /opt/lace is newer than this extension: it speaks engine protocol 3 and this extension speaks 2. Update the Lace extension.',
    );
  });

  test('waiting for a running engine starts nothing', async () => {
    const manager = fakeManager();
    const engine = createEngine(manager, settings);

    let resolved = false;
    const waiting = engine.whenRunning().then((caller) => {
      resolved = true;
      return caller;
    });
    await tick();
    expect(manager.starts).toBe(0);
    expect(resolved).toBe(false);

    manager.enter('starting');
    manager.run();
    expect(await version(await waiting)).toBe('engine1');
  });
});

describe('a restarted engine', () => {
  test('is a new transport, and the caller handed out next reaches it', async () => {
    const manager = fakeManager();
    const engine = createEngine(manager, settings);
    manager.enter('starting');
    manager.run();
    const before = await engine.caller();

    manager.enter('stopped');
    manager.enter('starting');
    manager.run();
    const after = await engine.caller();

    expect(after).not.toBe(before);
    expect(await version(after)).toBe('engine2');
  });

  test("a caller asked for during the manager's own restart waits for it", async () => {
    const manager = fakeManager();
    const engine = createEngine(manager, settings);
    manager.enter('starting');

    const asked = engine.caller();
    await tick();
    manager.run();

    expect(await version(await asked)).toBe('engine1');
    expect(manager.starts).toBe(0);
  });

  test("a caller asked for during the manager's own restart is refused when that restart fails", async () => {
    const manager = fakeManager();
    const engine = createEngine(manager, settings);
    manager.enter('starting');

    const asked = engine.caller().catch((error) => error);
    await tick();
    manager.enter('error');

    expect(await asked).toBeInstanceOf(EngineStoppedError);
  });
});

describe("serving a webview's bridge", () => {
  test('forwards its frames to the running engine until disposed', async () => {
    const manager = fakeManager();
    const engine = createEngine(manager, settings);
    manager.enter('starting');
    manager.run();

    const answers: BridgeResponse[] = [];
    let toHost: (frame: unknown) => void = () => {};
    const dispose = await engine.serve({
      post: (frame) => answers.push(frame as BridgeResponse),
      onMessage: (listener) => {
        toHost = listener;
        return () => {
          toHost = () => {};
        };
      },
    });
    const ask = (id: string): BridgeRequest => ({
      kind: 'unary',
      id,
      method: 'Initialize',
      request: {},
    });

    toHost(ask('1'));
    expect(answers).toMatchObject([{ kind: 'result', id: '1' }]);

    dispose();
    toHost(ask('2'));
    expect(answers).toHaveLength(1);
  });
});

describe('the engine settings', () => {
  test('are read from the lace section each time they are asked', () => {
    const values: Record<string, unknown> = { binaryPath: '/a/lace', autoRestart: false };
    const getConfiguration = vi.fn(() => ({ get: (key: string) => values[key] }));
    const read = engineSettings({ getConfiguration } as never);

    expect(read.binaryPath()).toBe('/a/lace');
    expect(read.autoRestart()).toBe(false);
    values.binaryPath = '/b/lace';
    expect(read.binaryPath()).toBe('/b/lace');
    expect(getConfiguration).toHaveBeenCalledWith('lace');
  });

  test('run the lace on PATH while lace.binaryPath is not set', () => {
    const getConfiguration = () => ({ get: (_key: string, fallback: unknown) => fallback });
    expect(engineSettings({ getConfiguration } as never).binaryPath()).toBe('lace');
  });

  test('run the executable lace.binaryPath names, as it is spelled', () => {
    const named = 'C:\\Users\\dev\\scoop\\shims\\lace.exe';
    const getConfiguration = () => ({ get: () => named });
    expect(engineSettings({ getConfiguration } as never).binaryPath()).toBe(named);
  });
});

describe('the engine controls', () => {
  function fakeApi() {
    const status = { text: '', command: undefined as unknown, show: vi.fn(), dispose: vi.fn() };
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const api = {
      window: { createStatusBarItem: () => status, showErrorMessage: vi.fn() },
      commands: {
        registerCommand: (id: string, run: (...args: unknown[]) => unknown) => {
          registered.set(id, run);
          return { dispose: () => registered.delete(id) };
        },
      },
    };
    return { api, status, registered };
  }

  test('show the state in the status bar and register the four engine commands', async () => {
    const manager = fakeManager();
    const engine = createEngine(manager, settings);
    const { api, status, registered } = fakeApi();
    const log = { show: vi.fn() };
    const controls = engineControls(api as never, engine, log);

    expect(status.text).toBe('Lace Engine: stopped');
    manager.enter('starting');
    expect(status.text).toBe('Lace Engine: starting');
    manager.run();
    expect(status.text).toBe('Lace Engine: running');

    expect([...registered.keys()].sort()).toEqual([
      'lace.openLogs',
      'lace.restartEngine',
      'lace.startEngine',
      'lace.stopEngine',
    ]);
    await registered.get('lace.openLogs')?.();
    expect(log.show).toHaveBeenCalled();
    await registered.get('lace.stopEngine')?.();
    expect(status.text).toBe('Lace Engine: stopped');

    controls.dispose();
    expect(registered.size).toBe(0);
    manager.enter('starting');
    expect(status.text).toBe('Lace Engine: stopped');
  });

  test('a command that fails says so once', async () => {
    const manager = fakeManager();
    manager.failure = new Error('exited before its handshake');
    const engine = createEngine(manager, settings);
    const { api, registered } = fakeApi();
    engineControls(api as never, engine, { show: vi.fn() });

    const started = registered.get('lace.startEngine')?.();
    await tick();
    manager.come();
    await started;

    expect(api.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'The Lace engine did not start from /opt/lace (the setting lace.binaryPath): exited before its handshake.',
    );
  });
});
