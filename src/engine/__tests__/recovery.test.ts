import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEngineSession } from '@lace-cloud/canvas/engine';
import { Bundle } from '@lace-cloud/proto';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecovery } from '../recovery';
import type { RootSession } from '../root-sessions';
import { fakeEngine } from './fake-engine';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const root = '/test/example';
function source(unsaved: boolean, digest = 'working') {
  return {
    bundle: Bundle.fromPartial({}),
    unsaved,
    workingDigest: digest,
    savedDigest: 'saved',
    treeHash: 'tree',
  };
}
function fakeSession(initial: ReturnType<typeof source>) {
  let latest = initial;
  const listeners = new Set<(s: ReturnType<typeof source>) => void>();
  const actions: unknown[] = [];
  const session = {
    root,
    sessionId: 'one',
    ports: {
      source: {
        subscribe(on: (s: ReturnType<typeof source>) => void) {
          listeners.add(on);
          on(latest);
          return () => listeners.delete(on);
        },
      },
      editor: {
        async apply(action: [{ restore: { captured_working_digest: string } }]) {
          actions.push(action);
          latest = source(true, action[0].restore.captured_working_digest);
          for (const on of listeners) on(latest);
          return { success: true, errors: [], created: [], ties: [] };
        },
      },
    },
  } as unknown as RootSession;
  return {
    session,
    actions,
    publish(frame: ReturnType<typeof source>) {
      latest = frame;
      for (const on of listeners) on(frame);
    },
  };
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'lace-recovery-'));
  dirs.push(directory);
  const values = new Map<string, string>();
  const secrets = {
    async get(key: string) {
      return values.get(key);
    },
    async store(key: string, value: string) {
      values.set(key, value);
    },
    async delete(key: string) {
      values.delete(key);
    },
  };
  const reports: string[] = [];
  const make = (choice: 'restore' | 'discard' | 'later') =>
    createRecovery({
      directory,
      machine: 'test-machine',
      isAlive: () => false,
      secrets,
      choose: async () => choice,
      report: (message) => reports.push(message),
    });
  return { values, make, reports, directory, secrets };
}

describe('canvas recovery', () => {
  it('publishes complete owner metadata before a first backup write can be interrupted', async () => {
    const { directory, secrets, values } = await setup();
    let releaseWrite: (() => void) | undefined;
    let writeStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    const interrupted = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const slowSecrets = {
      ...secrets,
      async store(key: string, value: string) {
        writeStarted?.();
        await interrupted;
        await secrets.store(key, value);
      },
    };
    const opts = {
      directory,
      machine: 'same-scope',
      secrets: slowSecrets,
      choose: async () => 'restore' as const,
      report: () => {},
      isAlive: () => false,
    };
    const attachment = createRecovery(opts).attach(fakeSession(source(true)).session);
    await started;
    const folder = join(directory, 'recovery', createHash('sha256').update(root).digest('hex'));
    const ids = (await readdir(folder)).filter((name) => !name.startsWith('.'));
    expect(ids).toHaveLength(1);
    expect(JSON.parse(await readFile(join(folder, ids[0]!), 'utf8'))).toMatchObject({
      machine: 'same-scope',
      pid: process.pid,
    });
    expect(values.size).toBe(0);
    await expect(createRecovery(opts).prepare(fakeSession(source(false)).session)).rejects.toThrow(
      'No backup data was found',
    );
    releaseWrite?.();
    await attachment.flush?.();
    expect(values.size).toBe(1);
  });
  it('offers to remove an incomplete record after its owner process has exited', async () => {
    const { directory, secrets } = await setup();
    const failedSecrets = {
      ...secrets,
      async store() {
        throw new Error('keychain failed');
      },
    };
    const opts = { directory, machine: 'scope', secrets: failedSecrets, report: () => {} };
    const writer = createRecovery({ ...opts, choose: async () => 'later' });
    const attachment = writer.attach(fakeSession(source(true)).session);
    await expect(attachment.flush?.()).rejects.toThrow('Could not update');
    attachment.dispose();
    const states: string[] = [];
    const next = createRecovery({
      ...opts,
      isAlive: () => false,
      choose: async (_root, state) => {
        states.push(state);
        return 'discard';
      },
    });
    await next.prepare(fakeSession(source(false)).session);
    expect(states).toEqual(['missing']);
    const folder = join(directory, 'recovery', createHash('sha256').update(root).digest('hex'));
    expect(await readdir(folder)).toEqual([]);
  });
  it('does not offer removal of a missing backup while its owner is alive', async () => {
    const { directory, secrets } = await setup();
    const failedSecrets = {
      ...secrets,
      async store() {
        throw new Error('keychain failed');
      },
    };
    const opts = { directory, machine: 'scope', secrets: failedSecrets, report: () => {} };
    const attachment = createRecovery({ ...opts, choose: async () => 'later' }).attach(
      fakeSession(source(true)).session,
    );
    await expect(attachment.flush?.()).rejects.toThrow('Could not update');
    attachment.dispose();
    let asked = false;
    const next = createRecovery({
      ...opts,
      isAlive: () => true,
      choose: async () => {
        asked = true;
        return 'discard';
      },
    });
    await expect(next.prepare(fakeSession(source(false)).session)).rejects.toThrow(
      'another active window',
    );
    expect(asked).toBe(false);
  });
  it('never lets another active window discard the only backup', async () => {
    const { values, directory, secrets } = await setup();
    const makeLive = (choice: 'discard' | 'restore') =>
      createRecovery({
        directory,
        machine: 'same-machine',
        secrets,
        isAlive: () => true,
        choose: async () => choice,
        report: () => {},
      });
    const owner = makeLive('restore');
    const old = owner.attach(fakeSession(source(true)).session);
    await old.flush?.();
    old.dispose(); // the engine ended, but the extension host is still running
    const original = [...values.entries()];
    await expect(
      makeLive('discard').prepare(fakeSession(source(false, 'current')).session),
    ).rejects.toThrow('another active window');
    expect([...values.entries()]).toEqual(original);
    const reopened = fakeSession(source(false, 'current'));
    await owner.prepare(reopened.session);
    expect(reopened.actions).toHaveLength(1);
  });
  it('allows recovery after the owner process has exited', async () => {
    const { values, directory, secrets } = await setup();
    const opts = {
      directory,
      machine: 'same-machine',
      secrets,
      choose: async () => 'restore' as const,
      report: () => {},
    };
    const owner = createRecovery({ ...opts, isAlive: () => true });
    const old = owner.attach(fakeSession(source(true)).session);
    await old.flush?.();
    old.dispose();
    const reopened = fakeSession(source(false, 'current'));
    await createRecovery({ ...opts, isAlive: () => false }).prepare(reopened.session);
    expect(reopened.actions).toHaveLength(1);
    expect(values.size).toBe(1);
  });
  it('protects a backup while its owner process lives and recovers after it exits', async () => {
    const { directory, secrets } = await setup();
    const opts = {
      directory,
      machine: 'same-scope',
      secrets,
      choose: async () => 'restore' as const,
      report: () => {},
    };
    const owner = createRecovery(opts);
    const attached = owner.attach(fakeSession(source(true)).session);
    await attached.flush?.();
    attached.dispose();
    const folder = join(directory, 'recovery', createHash('sha256').update(root).digest('hex'));
    const [name] = await readdir(folder);
    if (!name) throw new Error('marker was not written');
    const marker = join(folder, name);
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      await writeFile(
        marker,
        JSON.stringify({ ...JSON.parse(await readFile(marker, 'utf8')), pid: child.pid }),
      );
      const next = fakeSession(source(false, 'current'));
      await expect(createRecovery(opts).prepare(next.session)).rejects.toThrow(
        'another active window',
      );
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill();
      await exited;
      await createRecovery(opts).prepare(next.session);
      expect(next.actions).toHaveLength(1);
    } finally {
      child.kill();
    }
  });
  it('keeps backups when the process scope cannot be compared', async () => {
    const { values, directory, secrets } = await setup();
    const opts = { directory, secrets, choose: async () => 'discard' as const, report: () => {} };
    const owner = createRecovery({ ...opts, machine: 'namespace-a' });
    const attached = owner.attach(fakeSession(source(true)).session);
    await attached.flush?.();
    attached.dispose();
    await expect(
      createRecovery({ ...opts, machine: 'namespace-b', isAlive: () => false }).prepare(
        fakeSession(source(false)).session,
      ),
    ).rejects.toThrow('another active window');
    expect(values.size).toBe(1);
  });
  it('keeps a backup when its owner metadata is malformed', async () => {
    const { values, directory, secrets } = await setup();
    const opts = {
      directory,
      machine: 'same-scope',
      secrets,
      choose: async () => 'discard' as const,
      report: () => {},
    };
    const attached = createRecovery(opts).attach(fakeSession(source(true)).session);
    await attached.flush?.();
    attached.dispose();
    const folder = join(directory, 'recovery', createHash('sha256').update(root).digest('hex'));
    const [name] = await readdir(folder);
    if (!name) throw new Error('marker was not written');
    await writeFile(join(folder, name), '{');
    await expect(createRecovery(opts).prepare(fakeSession(source(false)).session)).rejects.toThrow(
      'Cannot verify',
    );
    expect(values.size).toBe(1);
  });
  it('carries a restore through the real canvas bridge codec', async () => {
    const engine = fakeEngine();
    const session = await openEngineSession(engine.caller, { root });
    await session.ports.editor.apply([
      {
        restore: {
          bundle: Bundle.fromPartial({}),
          captured_working_digest: 'work',
          captured_saved_digest: 'saved',
          captured_tree_hash: 'tree',
          expected_working_digest: 'current',
        },
      },
    ]);
    const sent = engine.sent.find((request) => request.method === 'ApplyAction');
    expect(sent?.request.actions).toEqual([
      expect.objectContaining({
        restore: expect.objectContaining({
          capturedWorkingDigest: 'work',
          capturedSavedDigest: 'saved',
          capturedTreeHash: 'tree',
          expectedWorkingDigest: 'current',
        }),
      }),
    ]);
    session.close();
  });
  it('stores an unsaved frame and restores it on a new host before editing', async () => {
    const { values, make } = await setup();
    const writer = make('later');
    const old = fakeSession(source(true));
    const attachment = writer.attach(old.session);
    await attachment.flush?.();
    attachment.dispose();
    expect(values.size).toBe(1);
    const next = fakeSession(source(false, 'current'));
    const reader = make('restore');
    await reader.prepare(next.session);
    expect(next.actions).toEqual([
      [
        {
          restore: expect.objectContaining({
            captured_working_digest: 'working',
            captured_saved_digest: 'saved',
            captured_tree_hash: 'tree',
            expected_working_digest: 'current',
          }),
        },
      ],
    ]);
    expect(values.size).toBe(1);
  });
  it('keeps a backup when the developer chooses later', async () => {
    const { values, make } = await setup();
    const first = make('later').attach(fakeSession(source(true)).session);
    await first.flush?.();
    first.dispose();
    await expect(
      make('later').prepare(fakeSession(source(false, 'current')).session),
    ).rejects.toThrow('deferred');
    expect(values.size).toBe(1);
  });
  it('keeps every other window’s backup when one restore fails', async () => {
    const { values, make } = await setup();
    const one = make('later').attach(fakeSession(source(true, 'first')).session);
    const two = make('later').attach(fakeSession(source(true, 'second')).session);
    await Promise.all([one.flush?.(), two.flush?.()]);
    one.dispose();
    two.dispose();
    const next = fakeSession(source(false, 'current'));
    next.session.ports.editor.apply = async () => {
      throw new Error('stale');
    };
    await expect(make('restore').prepare(next.session)).rejects.toThrow('stale');
    expect(values.size).toBe(2);
  });
  it('backs up an edit made after restore and before attachment', async () => {
    const { values, make } = await setup();
    const one = make('later').attach(fakeSession(source(true)).session);
    await one.flush?.();
    one.dispose();
    const next = fakeSession(source(false, 'current'));
    const reader = make('restore');
    await reader.prepare(next.session);
    next.publish(source(true, 'newer'));
    const attached = reader.attach(next.session);
    await attached.flush?.();
    expect(JSON.parse([...values.values()][0] ?? '{}').working).toBe('newer');
    next.publish(source(true, 'newest'));
    await attached.flush?.();
    expect(JSON.parse([...values.values()][0] ?? '{}').working).toBe('newest');
  });
  it('removes a backup when another holder saves before attachment', async () => {
    const { values, make } = await setup();
    const old = make('later').attach(fakeSession(source(true)).session);
    await old.flush?.();
    old.dispose();
    const next = fakeSession(source(false, 'current'));
    const reader = make('restore');
    await reader.prepare(next.session);
    next.publish(source(false, 'working'));
    const attached = reader.attach(next.session);
    await attached.flush?.();
    expect(values.size).toBe(0);
  });
  it('stores bundle, digests and tree hash of one and the same unsaved frame', async () => {
    const { values, make } = await setup();
    const live = fakeSession(source(true, 'w1'));
    const attached = make('later').attach(live.session);
    live.publish({ ...source(true, 'w2'), savedDigest: 's2', treeHash: 't2' });
    await attached.flush?.();
    const stored = JSON.parse([...values.values()][0] ?? '{}');
    expect(stored).toMatchObject({ working: 'w2', saved: 's2', tree: 't2' });
  });
  it('writes the last unsaved frame by the time flush settles', async () => {
    const { values, make } = await setup();
    const live = fakeSession(source(true, 'w1'));
    const attached = make('later').attach(live.session);
    for (const digest of ['w2', 'w3', 'w4']) live.publish(source(true, digest));
    await attached.flush?.();
    expect(JSON.parse([...values.values()][0] ?? '{}').working).toBe('w4');
  });
  it('drops the backup once a clean frame follows the unsaved one', async () => {
    const { values, make } = await setup();
    const live = fakeSession(source(true));
    const attached = make('later').attach(live.session);
    await attached.flush?.();
    expect(values.size).toBe(1);
    live.publish(source(false, 'saved'));
    await attached.flush?.();
    expect(values.size).toBe(0);
  });
  it('keeps the backup while frames stay unsaved', async () => {
    const { values, make } = await setup();
    const live = fakeSession(source(true));
    const attached = make('later').attach(live.session);
    live.publish(source(true, 'more'));
    await attached.flush?.();
    expect(values.size).toBe(1);
  });
  it('a window going clean does not delete another window’s backup of the same root', async () => {
    const { values, make } = await setup();
    const one = make('later').attach(fakeSession(source(true, 'first')).session);
    const cleanSession = fakeSession(source(true, 'second'));
    const two = make('later').attach(cleanSession.session);
    await Promise.all([one.flush?.(), two.flush?.()]);
    expect(values.size).toBe(2);
    cleanSession.publish(source(false, 'saved'));
    await two.flush?.();
    expect(values.size).toBe(1);
    expect(JSON.parse([...values.values()][0] ?? '{}').working).toBe('first');
  });
  it('removes the backup when the developer discards it, and sends no restore', async () => {
    const { values, make } = await setup();
    const first = make('later').attach(fakeSession(source(true)).session);
    await first.flush?.();
    first.dispose();
    const next = fakeSession(source(false, 'current'));
    await make('discard').prepare(next.session);
    expect(values.size).toBe(0);
    expect(next.actions).toEqual([]);
  });
  it('fails safe when the encrypted write fails: flush rejects and the developer is told', async () => {
    const { make, reports, values } = await setup();
    const recovery = make('later');
    const live = fakeSession(source(false));
    const attached = recovery.attach(live.session);
    const store = values.set.bind(values);
    values.set = () => {
      throw new Error('keychain locked');
    };
    live.publish(source(true));
    await expect(attached.flush?.()).rejects.toThrow('Could not update');
    expect(reports).toHaveLength(1);
    values.set = store;
  });
  it('sends the live frame’s digest as expected, not the backup’s', async () => {
    const { make } = await setup();
    const first = make('later').attach(fakeSession(source(true, 'old')).session);
    await first.flush?.();
    first.dispose();
    const next = fakeSession(source(false, 'live-now'));
    await make('restore').prepare(next.session);
    const [[{ restore }]] = next.actions as [
      [{ restore: { expected_working_digest: string; captured_working_digest: string } }],
    ];
    expect(restore.expected_working_digest).toBe('live-now');
    expect(restore.captured_working_digest).toBe('old');
  });
  it('keeps the backup and surfaces the engine’s refusal', async () => {
    const { values, make } = await setup();
    const first = make('later').attach(fakeSession(source(true)).session);
    await first.flush?.();
    first.dispose();
    const next = fakeSession(source(false, 'current'));
    next.session.ports.editor.apply = async () => {
      throw new Error('tree changed on disk');
    };
    await expect(make('restore').prepare(next.session)).rejects.toThrow('tree changed on disk');
    expect(values.size).toBe(1);
  });
  it('keeps the original backup and surfaces a returned refusal', async () => {
    const { values, make } = await setup();
    const first = make('later').attach(fakeSession(source(true)).session);
    await first.flush?.();
    first.dispose();
    const original = [...values.entries()];
    const next = fakeSession(source(false, 'current'));
    next.session.ports.editor.apply = async () => ({
      success: false,
      errors: [
        {
          message: 'tree changed on disk',
          moduleKey: '',
          instanceId: '',
          inputName: '',
          reason: 0,
        },
      ],
      created: [],
      ties: [],
    });
    await expect(make('restore').prepare(next.session)).rejects.toThrow('tree changed on disk');
    expect([...values.entries()]).toEqual(original);
  });
});
