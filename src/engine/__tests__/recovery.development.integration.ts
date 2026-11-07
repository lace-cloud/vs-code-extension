// Opt-in integration against LACE_DEVELOPMENT_ENGINE and matching local
// canvas, host and proto builds. It exercises real engine RPC and production
// recovery with a memory SecretStorage substitute; it is not a VS Code hot exit.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createEngine, engineManager } from '../engine';
import { createRecovery } from '../recovery';
import { createRootSessions } from '../root-sessions';

const binary = process.env.LACE_DEVELOPMENT_ENGINE;
if (!binary) throw new Error('Set LACE_DEVELOPMENT_ENGINE to the local engine build.');

function moduleDirectory(): { directory: string; root: string } {
  const directory = mkdtempSync(join(tmpdir(), 'lace-recovery-development-'));
  const root = join(directory, 'module');
  mkdirSync(root);
  execFileSync('git', ['init', '--quiet', directory]);
  writeFileSync(join(root, 'main.tf'), 'variable "name" {\n  type = string\n}\n');
  return { directory, root };
}

function engineWindow(prepare?: Parameters<typeof createRootSessions>[0]['prepare']) {
  const settings = { binaryPath: () => binary!, autoRestart: () => false };
  const engine = createEngine(
    engineManager(settings, () => {}),
    settings,
  );
  const reports: unknown[] = [];
  const sessions = createRootSessions({
    engine,
    report: (what, error) => reports.push({ what, error }),
    prepare,
  });
  return { engine, sessions, reports };
}

async function stop(window: ReturnType<typeof engineWindow>) {
  await window.sessions.dispose();
  await window.engine.stop();
}

test('the saved backup restores the unsaved real-engine session after reopening', async () => {
  const { directory, root } = moduleDirectory();
  const values = new Map<string, string>();
  const secrets = {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  };
  let previousOwnerAlive = true;
  const reports: string[] = [];
  const start = () => {
    const recovery = createRecovery({
      directory: join(directory, 'storage'),
      machine: 'test-machine',
      isAlive: () => previousOwnerAlive,
      secrets,
      choose: async () => 'restore',
      report: (message) => reports.push(message),
    });
    const window = engineWindow(recovery.prepare);
    window.sessions.observe(recovery.attach);
    return window;
  };
  const first = start();
  const second = start();
  try {
    const hold = await first.sessions.acquire(root);
    let frame: Parameters<Parameters<typeof hold.ports.source.subscribe>[0]>[0] | undefined;
    const unsubscribe = hold.ports.source.subscribe(
      (next) => {
        frame = next;
      },
      () => {},
    );
    expect(frame).toBeDefined();
    const result = await hold.ports.editor.apply([
      { set_variables: { scope: frame!.bundle.entry, variables: [] } },
    ]);
    expect(result.success).toBe(true);
    for (let attempt = 0; attempt < 100 && values.size === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(values.size).toBeGreaterThan(0);
    const captured = JSON.stringify(frame!.bundle);
    const refusal = await second.sessions.acquire(root).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(Error);
    unsubscribe();
    await stop(first);
    previousOwnerAlive = false; // Two simulated extension-host lifetimes in this test process.
    const restored = await second.sessions.acquire(root);
    let restoredFrame: typeof frame;
    restored.ports.source.subscribe(
      (next) => {
        restoredFrame = next;
      },
      () => {},
    )();
    expect(restoredFrame!.unsaved).toBe(true);
    expect(JSON.stringify(restoredFrame!.bundle)).toBe(captured);
    expect(reports).toEqual([]);
  } finally {
    await stop(first);
    await stop(second);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a refused preparation releases the real root lock', async () => {
  const { directory, root } = moduleDirectory();
  const first = engineWindow(async () => {
    throw new Error('deferred');
  });
  const second = engineWindow();
  try {
    await expect(first.sessions.acquire(root)).rejects.toThrow('deferred');
    const hold = await second.sessions.acquire(root);
    expect(hold.sessionId).toBeTruthy();
    await hold.release();
  } finally {
    await stop(first);
    await stop(second);
    rmSync(directory, { recursive: true, force: true });
  }
});
