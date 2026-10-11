import { ConnectError, Reason } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import {
  createRootSessions,
  NotObservedError,
  type Observation,
  type RootHold,
  type RootSession,
  RootSessionsDisposedError,
} from '../root-sessions';
import { type FakeEngine, fakeEngine, settled } from './fake-engine';

// `flush` is what an observer's attachment to each session does when it is
// flushed, as the autosave keeper's does.
function setup(
  options: { engine?: FakeEngine; flush?: (session: RootSession) => Promise<void> } = {},
) {
  const reports: { what: string; error: unknown }[] = [];
  const window = {
    engine: options.engine ?? fakeEngine(),
    // Resolved while the engine runs; a test replaces it to hold a restart.
    running: Promise.resolve(),
  };
  const rootSessions = createRootSessions({
    engine: {
      caller: async () => window.engine.caller,
      whenRunning: async (other) => {
        await window.running;
        if (window.engine.caller === other) await new Promise(() => {});
        return window.engine.caller;
      },
    },
    report: (what, error) => reports.push({ what, error }),
  });
  rootSessions.observe((session) => ({
    flush: () => options.flush?.(session) ?? Promise.resolve(),
    dispose: () => {},
  }));
  return { window, rootSessions, reports };
}

const closes = (engine: FakeEngine) =>
  engine.sent.filter((s) => s.method === 'SessionClose').map((s) => s.request.sessionId);

describe('holders of one root', () => {
  test('two acquires share one session', async () => {
    const { rootSessions } = setup();
    const a = await rootSessions.acquire('/repo/infra');
    const b = await rootSessions.acquire('/repo/infra');

    expect(b.sessionId).toBe(a.sessionId);
    expect(b.ports).toBe(a.ports);
    expect(rootSessions.held()).toMatchObject([{ sessionId: a.sessionId, holders: 2 }]);
  });

  test('two spellings of one directory are one session and one entry, by the id the engine names', async () => {
    const engine = fakeEngine({ sameDirectory: (path) => path.replace('/link/', '/real/') });
    const { rootSessions } = setup({ engine });
    const real = await rootSessions.acquire('/real/infra');
    const link = await rootSessions.acquire('/link/infra');

    expect(link.sessionId).toBe(real.sessionId);
    expect(rootSessions.held()).toHaveLength(1);
    expect(rootSessions.held()[0]).toMatchObject({ root: '/real/infra', holders: 2 });
    // Each spelling went to the engine as it was given.
    const asked = engine.sent.filter((s) => s.method === 'SessionOpen').map((s) => s.request.root);
    expect(asked).toEqual([{ path: '/real/infra' }, { path: '/link/infra' }]);
  });

  test('two roots are two sessions', async () => {
    const { rootSessions } = setup();
    const a = await rootSessions.acquire('/repo/a');
    const b = await rootSessions.acquire('/repo/b');
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(rootSessions.held()).toHaveLength(2);
  });

  test('a refused open rejects with the refusal and holds nothing', async () => {
    const engine = fakeEngine();
    engine.refuse('SessionOpen', 'REASON_ROOT_LOCKED');
    const { rootSessions } = setup({ engine });

    const refused = await rootSessions.acquire('/repo/infra').catch((error) => error);
    expect(refused).toBeInstanceOf(ConnectError);
    expect(refused.reason).toBe(Reason.REASON_ROOT_LOCKED);
    expect(rootSessions.held()).toEqual([]);
  });
});

describe('the last release', () => {
  test('closes the session once, and only when the last holder releases', async () => {
    const flush = vi.fn(async () => {});
    const { window, rootSessions } = setup({ flush });
    const a = await rootSessions.acquire('/repo/infra');
    const b = await rootSessions.acquire('/repo/infra');
    const id = a.sessionId;

    await a.release();
    expect(flush).not.toHaveBeenCalled();
    expect(closes(window.engine)).toEqual([]);
    expect(rootSessions.held()).toMatchObject([{ holders: 1 }]);

    await b.release();
    await b.release();
    await a.release();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(closes(window.engine)).toEqual([id]);
    expect(rootSessions.held()).toEqual([]);
    expect(window.engine.open()).toEqual([]);
  });

  test("sends SessionClose only after the autosave's flush settles", async () => {
    let saved = () => {};
    const flush = vi.fn(() => new Promise<void>((resolve) => (saved = resolve)));
    const { window, rootSessions } = setup({ flush });
    const hold = await rootSessions.acquire('/repo/infra');
    const id = hold.sessionId;

    const released = hold.release();
    await settled();
    expect(flush).toHaveBeenCalledWith(expect.objectContaining({ sessionId: id }));
    expect(closes(window.engine)).toEqual([]);

    saved();
    await released;
    expect(closes(window.engine)).toEqual([id]);
  });

  test('a flush that fails is reported and the session still closes', async () => {
    const failure = new Error('disk full');
    const { window, rootSessions, reports } = setup({ flush: () => Promise.reject(failure) });
    const hold = await rootSessions.acquire('/repo/infra');
    const id = hold.sessionId;

    await hold.release();
    expect(reports.map((r) => r.error)).toEqual([failure]);
    expect(closes(window.engine)).toEqual([id]);
  });

  test('an acquire while the session is closing rejoins it, and no close is sent', async () => {
    let saved = () => {};
    const { window, rootSessions } = setup({
      flush: () => new Promise<void>((resolve) => (saved = resolve)),
    });
    const first = await rootSessions.acquire('/repo/infra');
    const id = first.sessionId;

    const released = first.release();
    await settled();
    const second = await rootSessions.acquire('/repo/infra');
    saved();
    await released;

    expect(second.sessionId).toBe(id);
    expect(closes(window.engine)).toEqual([]);
    expect(window.engine.open()).toEqual([id]);
    expect(rootSessions.held()).toMatchObject([{ sessionId: id, holders: 1 }]);

    saved = () => {};
    const last = second.release();
    await settled();
    saved();
    await last;
    expect(closes(window.engine)).toEqual([id]);
  });
});

describe("an attachment that keeps unsaved work, as the autosave keeper's does", () => {
  function attached(options: { engine?: FakeEngine } = {}) {
    const engine = options.engine ?? fakeEngine();
    const autosaves: { sessionId: string; disposed: boolean; flushed: number }[] = [];
    const order: string[] = [];
    const rootSessions = createRootSessions({
      engine: {
        caller: async () => engine.caller,
        whenRunning: async () => engine.caller,
      },
      report: () => {},
    });
    rootSessions.observe((session) => {
      const made = { sessionId: session.sessionId, disposed: false, flushed: 0 };
      autosaves.push(made);
      return {
        flush: async () => {
          made.flushed += 1;
          order.push(`flush, ${closes(engine).length} closed`);
        },
        dispose: () => {
          made.disposed = true;
          order.push(`dispose, ${closes(engine).length} closed`);
        },
      };
    });
    return { engine, rootSessions, autosaves, order };
  }

  test('one is attached when the root is opened, and a second holder attaches none', async () => {
    const { rootSessions, autosaves } = attached();
    const a = await rootSessions.acquire('/repo/infra');
    await rootSessions.acquire('/repo/infra');
    expect(autosaves).toEqual([{ sessionId: a.sessionId, disposed: false, flushed: 0 }]);
  });

  test('a session opened again after its stream failed has a new one, and the old one is disposed', async () => {
    const { engine, rootSessions, autosaves } = attached();
    const hold = await rootSessions.acquire('/repo/infra');
    engine.failStreams(hold.sessionId);
    await settled();
    expect(autosaves).toEqual([
      { sessionId: hold.sessionId, disposed: true, flushed: 0 },
      { sessionId: hold.sessionId, disposed: false, flushed: 0 },
    ]);
  });

  test('the last release flushes it, then disposes it, then closes the session', async () => {
    const { engine, rootSessions, autosaves, order } = attached();
    const hold = await rootSessions.acquire('/repo/infra');
    await hold.release();
    expect(autosaves).toEqual([{ sessionId: hold.sessionId, disposed: true, flushed: 1 }]);
    expect(order).toEqual(['flush, 0 closed', 'dispose, 0 closed']);
    expect(closes(engine)).toEqual([hold.sessionId]);
  });

  test('the close waits on every attachment that carries a flush, and detaches one that carries none', async () => {
    const { engine, rootSessions, order } = attached();
    let saved = () => {};
    rootSessions.observe(() => ({
      flush: () => new Promise<void>((resolve) => (saved = resolve)),
      dispose: () => order.push(`second dispose, ${closes(engine).length} closed`),
    }));
    rootSessions.observe(() => ({
      dispose: () => order.push(`third dispose, ${closes(engine).length} closed`),
    }));
    const hold = await rootSessions.acquire('/repo/infra');

    const released = hold.release();
    await settled();
    expect(closes(engine)).toEqual([]);
    saved();
    await released;
    expect(order).toEqual([
      'flush, 0 closed',
      'dispose, 0 closed',
      'second dispose, 0 closed',
      'third dispose, 0 closed',
    ]);
    expect(closes(engine)).toEqual([hold.sessionId]);
  });
});

describe('SessionOpen and SessionClose are sent one at a time', () => {
  test('no SessionOpen is sent while a SessionClose is unanswered', async () => {
    const { window, rootSessions } = setup();
    const first = await rootSessions.acquire('/repo/infra');
    const id = first.sessionId;

    const answerClose = window.engine.defer('SessionClose');
    const released = first.release();
    await settled();
    expect(closes(window.engine)).toEqual([id]);

    const acquiring = rootSessions.acquire('/repo/infra');
    await settled();
    expect(window.engine.count('SessionOpen')).toBe(1);

    answerClose();
    await released;
    const second = await acquiring;
    expect(window.engine.count('SessionOpen')).toBe(2);
    expect(second.sessionId).not.toBe(id);
    expect(window.engine.open()).toEqual([second.sessionId]);
  });

  test('a release decided while an open is unanswered waits for it, and the session it joined stays open', async () => {
    const { window, rootSessions } = setup();
    const first = await rootSessions.acquire('/repo/infra');
    const id = first.sessionId;

    const answerOpen = window.engine.defer('SessionOpen');
    const acquiring = rootSessions.acquire('/repo/infra');
    await settled();
    const released = first.release();
    await settled();
    expect(closes(window.engine)).toEqual([]);

    answerOpen();
    const second = await acquiring;
    await released;
    expect(second.sessionId).toBe(id);
    expect(closes(window.engine)).toEqual([]);
    expect(window.engine.open()).toEqual([id]);
  });
});

describe('a hold follows its session across an end', () => {
  test('a failed stream on a live session: the holders stay, nothing is closed, and frames arrive again', async () => {
    const { window, rootSessions } = setup();
    const hold = await rootSessions.acquire('/repo/infra');
    const id = hold.sessionId;
    const renewed = vi.fn();
    hold.renewed(renewed);

    window.engine.failStreams(id);
    await settled();

    expect(renewed).toHaveBeenCalledTimes(1);
    expect(hold.sessionId).toBe(id);
    expect(closes(window.engine)).toEqual([]);
    expect(rootSessions.held()).toMatchObject([{ sessionId: id, holders: 1 }]);

    const unsaved: boolean[] = [];
    hold.ports.source.subscribe(
      (frame) => unsaved.push(frame.unsaved),
      () => {},
    );
    window.engine.edit(id);
    await settled();
    expect(unsaved).toEqual([false, true]);

    await hold.release();
    expect(closes(window.engine)).toEqual([id]);
  });

  test('a session another client closed: the root is opened again and the hold is on the new session', async () => {
    const { window, rootSessions } = setup();
    const hold = await rootSessions.acquire('/repo/infra');
    const gone = hold.sessionId;
    const renewed = vi.fn();
    hold.renewed(renewed);

    window.engine.closeFromElsewhere(gone);
    await settled();

    expect(renewed).toHaveBeenCalledTimes(1);
    expect(hold.sessionId).not.toBe(gone);
    expect(window.engine.open()).toEqual([hold.sessionId]);
    expect(rootSessions.held()).toMatchObject([{ sessionId: hold.sessionId, holders: 1 }]);

    const current = hold.sessionId;
    await hold.release();
    expect(closes(window.engine)).toEqual([current]);
  });

  test('an engine restart: the holder is on the new engine, and a later edit by another holder does not close its session', async () => {
    const { window, rootSessions } = setup();
    const before = window.engine;
    const canvas = await rootSessions.acquire('/repo/infra');
    const stale = canvas.sessionId;

    let restarted = () => {};
    window.running = new Promise<void>((resolve) => (restarted = resolve));
    before.crash();
    await settled();
    // No engine runs: nothing is opened yet, and the hold is still held.
    expect(before.count('SessionOpen')).toBe(1);

    window.engine = fakeEngine();
    restarted();
    await settled();
    expect(canvas.sessionId).not.toBe(stale);
    expect(window.engine.open()).toEqual([canvas.sessionId]);

    // What an edit from the sidebar does: its own hold for the call.
    const edit = await rootSessions.acquire('/repo/infra');
    expect(edit.sessionId).toBe(canvas.sessionId);
    await edit.release();

    expect(closes(window.engine)).toEqual([]);
    expect(window.engine.open()).toEqual([canvas.sessionId]);
    expect(rootSessions.held()).toMatchObject([{ sessionId: canvas.sessionId, holders: 1 }]);
    // The stale id was never closed, on either engine.
    expect(closes(before)).toEqual([]);

    const current = canvas.sessionId;
    await canvas.release();
    expect(closes(window.engine)).toEqual([current]);
  });

  test('an acquire that reaches the restarted engine first: the earlier holders join its session', async () => {
    const { window, rootSessions } = setup();
    const canvas = await rootSessions.acquire('/repo/infra');

    let restarted = () => {};
    window.running = new Promise<void>((resolve) => (restarted = resolve));
    window.engine.crash();
    await settled();
    window.engine = fakeEngine();

    const edit = await rootSessions.acquire('/repo/infra');
    restarted();
    await settled();

    expect(canvas.sessionId).toBe(edit.sessionId);
    expect(rootSessions.held()).toMatchObject([{ sessionId: edit.sessionId, holders: 2 }]);

    await edit.release();
    expect(closes(window.engine)).toEqual([]);
    await canvas.release();
    expect(closes(window.engine)).toEqual([edit.sessionId]);
  });

  test('a root that cannot be opened again: the holder is told, it is reported, and no close is sent for the closed session', async () => {
    const { window, rootSessions, reports } = setup();
    const hold = await rootSessions.acquire('/repo/infra');
    const gone = hold.sessionId;
    const renewed = vi.fn();
    hold.renewed(renewed);

    window.engine.refuse('SessionOpen', 'REASON_ROOT_LOCKED');
    window.engine.closeFromElsewhere(gone);
    await settled();

    expect(renewed).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(1);
    expect(reports[0].error).toBeInstanceOf(ConnectError);
    expect(hold.sessionId).toBe(gone);

    await hold.release();
    expect(closes(window.engine)).toEqual([]);
  });

  test('a stream that fails while the session is closing: the session is still closed', async () => {
    let saved = () => {};
    const { window, rootSessions } = setup({
      flush: () => new Promise<void>((resolve) => (saved = resolve)),
    });
    const hold = await rootSessions.acquire('/repo/infra');
    const id = hold.sessionId;

    const released = hold.release();
    await settled();
    window.engine.failStreams(id);
    await settled();
    saved();
    await released;

    expect(window.engine.count('SessionOpen')).toBe(1);
    expect(closes(window.engine)).toEqual([id]);
    expect(window.engine.open()).toEqual([]);
  });

  test('a session another client closed while it was closing: nothing is opened and nothing is closed', async () => {
    let saved = () => {};
    const { window, rootSessions } = setup({
      flush: () => new Promise<void>((resolve) => (saved = resolve)),
    });
    const hold = await rootSessions.acquire('/repo/infra');

    const released = hold.release();
    await settled();
    window.engine.closeFromElsewhere(hold.sessionId);
    await settled();
    saved();
    await released;

    expect(window.engine.count('SessionOpen')).toBe(1);
    expect(closes(window.engine)).toEqual([]);
  });

  test('a renewal listener that throws is reported and the others still run', async () => {
    const { window, rootSessions, reports } = setup();
    const hold = await rootSessions.acquire('/repo/infra');
    const failure = new Error('listener');
    const second = vi.fn();
    hold.renewed(() => {
      throw failure;
    });
    hold.renewed(second);

    window.engine.failStreams(hold.sessionId);
    await settled();

    expect(reports.map((r) => r.error)).toEqual([failure]);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('dispose', () => {
  test('saves every held session at once, closes none, and later releases send nothing', async () => {
    const saving: string[] = [];
    let saved = () => {};
    const flush = (session: RootSession) => {
      saving.push(session.root);
      return new Promise<void>((resolve) => {
        const earlier = saved;
        saved = () => {
          earlier();
          resolve();
        };
      });
    };
    const { window, rootSessions } = setup({ flush });
    const a = await rootSessions.acquire('/repo/a');
    const b = await rootSessions.acquire('/repo/b');

    const disposed = rootSessions.dispose();
    await settled();
    expect(saving).toEqual(['/repo/a', '/repo/b']);

    saved();
    await disposed;
    await a.release();
    await b.release();
    expect(closes(window.engine)).toEqual([]);
    expect(rootSessions.held()).toEqual([]);
    await expect(rootSessions.acquire('/repo/a')).rejects.toBeInstanceOf(RootSessionsDisposedError);
  });

  test('waits for the save of a session that was already closing', async () => {
    let saved = () => {};
    const flush = vi.fn(() => new Promise<void>((resolve) => (saved = resolve)));
    const { window, rootSessions } = setup({ flush });
    const hold = await rootSessions.acquire('/repo/infra');

    const released = hold.release();
    await settled();
    let done = false;
    const disposed = rootSessions.dispose().then(() => {
      done = true;
    });
    await settled();
    expect(done).toBe(false);
    expect(flush).toHaveBeenCalledTimes(1);

    saved();
    await disposed;
    await released;
    expect(closes(window.engine)).toEqual([]);
  });
});

describe('observers', () => {
  // An observer that records what it was attached to and detached from.
  function recorder() {
    const events: string[] = [];
    const observer = vi.fn((session: RootSession) => {
      events.push(`attach ${session.sessionId}`);
      return { dispose: () => events.push(`detach ${session.sessionId}`) };
    });
    return { events, observer };
  }

  test('attach to a session once it has a holder, and detach at the close the last release sends', async () => {
    const { window, rootSessions } = setup();
    const { events, observer } = recorder();
    rootSessions.observe(observer);

    const a = await rootSessions.acquire('/repo/infra');
    const b = await rootSessions.acquire('/repo/infra');
    expect(events).toEqual([`attach ${a.sessionId}`]);
    expect(observer).toHaveBeenCalledWith(expect.objectContaining({ root: '/repo/infra' }));

    await a.release();
    expect(events).toEqual([`attach ${a.sessionId}`]);
    await b.release();
    expect(events).toEqual([`attach ${a.sessionId}`, `detach ${a.sessionId}`]);
    expect(closes(window.engine)).toEqual([a.sessionId]);
  });

  test('an observer added later attaches to the sessions already held, and is no holder', async () => {
    const { window, rootSessions } = setup();
    const hold = await rootSessions.acquire('/repo/infra');
    const { events, observer } = recorder();
    const observation = rootSessions.observe(observer);
    expect(events).toEqual([`attach ${hold.sessionId}`]);

    observation.dispose();
    expect(events).toEqual([`attach ${hold.sessionId}`, `detach ${hold.sessionId}`]);
    expect(rootSessions.held()).toMatchObject([{ holders: 1 }]);
    expect(closes(window.engine)).toEqual([]);
  });

  test('a renewal moves the observer to the session the root is opened on again', async () => {
    const { window, rootSessions } = setup();
    const { events, observer } = recorder();
    rootSessions.observe(observer);
    const hold = await rootSessions.acquire('/repo/infra');
    const gone = hold.sessionId;

    window.engine.closeFromElsewhere(gone);
    await settled();

    expect(events).toEqual([`attach ${gone}`, `detach ${gone}`, `attach ${hold.sessionId}`]);
  });

  test('earlier holders that join a session another acquire reached first are detached from theirs', async () => {
    const { window, rootSessions } = setup();
    const { events, observer } = recorder();
    rootSessions.observe(observer);
    const canvas = await rootSessions.acquire('/repo/infra');
    const stale = canvas.sessionId;

    let restarted = () => {};
    window.running = new Promise<void>((resolve) => (restarted = resolve));
    window.engine.crash();
    await settled();
    window.engine = fakeEngine();
    const edit = await rootSessions.acquire('/repo/infra');
    restarted();
    await settled();

    expect(events).toEqual([`attach ${stale}`, `attach ${edit.sessionId}`, `detach ${stale}`]);
  });

  test('an observer that throws is reported, and the session and the other observers go on', async () => {
    const { rootSessions, reports } = setup();
    const failure = new Error('observer');
    rootSessions.observe(() => {
      throw failure;
    });
    const { events, observer } = recorder();
    rootSessions.observe(observer);

    const hold = await rootSessions.acquire('/repo/infra');
    expect(reports.map((r) => r.error)).toEqual([failure]);
    expect(events).toEqual([`attach ${hold.sessionId}`]);
  });

  // What a hold runs on now.
  const runOn = <A extends { dispose: () => void }>(
    observation: Observation<A>,
    hold: RootHold,
  ): Promise<A> => observation.use(hold, async (attachment) => attachment);

  test('a hold runs on what the observer attached to its session, until the root leaves it', async () => {
    const { window, rootSessions } = setup();
    const observation = rootSessions.observe((session) => ({
      sessionId: session.sessionId,
      dispose: () => {},
    }));
    const hold = await rootSessions.acquire('/repo/infra');
    const joined = await rootSessions.acquire('/repo/infra');
    const first = await runOn(observation, hold);

    expect(first).toMatchObject({ sessionId: hold.sessionId });
    expect(await runOn(observation, joined)).toBe(first);

    await joined.release();
    expect(await runOn(observation, hold)).toBe(first);
    await hold.release();
    expect(closes(window.engine)).toEqual([first.sessionId]);
    await expect(runOn(observation, hold)).rejects.toBeInstanceOf(NotObservedError);
  });

  test('each hold runs on what the observer attached to its own session', async () => {
    const { rootSessions } = setup();
    const observation = rootSessions.observe((session) => ({
      sessionId: session.sessionId,
      dispose: () => {},
    }));
    const a = await rootSessions.acquire('/repo/a');
    const b = await rootSessions.acquire('/repo/b');

    expect(await runOn(observation, a)).toMatchObject({ sessionId: a.sessionId });
    expect(await runOn(observation, b)).toMatchObject({ sessionId: b.sessionId });
  });

  test('after a renewal a hold runs on what the observer attached to the session it is on now', async () => {
    const { window, rootSessions } = setup();
    const disposed: string[] = [];
    const observation = rootSessions.observe((session) => ({
      sessionId: session.sessionId,
      dispose: () => disposed.push(session.sessionId),
    }));
    const hold = await rootSessions.acquire('/repo/infra');
    const gone = hold.sessionId;

    window.engine.closeFromElsewhere(gone);
    await settled();

    expect(hold.sessionId).not.toBe(gone);
    expect(await runOn(observation, hold)).toMatchObject({ sessionId: hold.sessionId });
    expect(disposed).toEqual([gone]);
  });

  test('a renewal while a run uses an attachment disposes it only when the run settles', async () => {
    const { window, rootSessions } = setup();
    const disposed: string[] = [];
    const observation = rootSessions.observe((session) => ({
      sessionId: session.sessionId,
      dispose: () => disposed.push(session.sessionId),
    }));
    const hold = await rootSessions.acquire('/repo/infra');
    const gone = hold.sessionId;
    let finish = () => {};
    const running = observation.use(hold, async (attachment) => {
      await new Promise<void>((resolve) => (finish = resolve));
      return attachment;
    });
    await settled();

    window.engine.closeFromElsewhere(gone);
    await settled();
    expect(hold.sessionId).not.toBe(gone);
    expect(disposed).toEqual([]);
    expect(await runOn(observation, hold)).toMatchObject({ sessionId: hold.sessionId });

    finish();
    expect(await running).toMatchObject({ sessionId: gone });
    expect(disposed).toEqual([gone]);
  });

  test('the close the last release sends while a run is under way disposes the attachment when the run settles', async () => {
    const { rootSessions } = setup();
    const disposed: string[] = [];
    const observation = rootSessions.observe((session) => ({
      dispose: () => disposed.push(session.sessionId),
    }));
    const hold = await rootSessions.acquire('/repo/infra');
    let finish = () => {};
    const running = observation.use(hold, () => new Promise<void>((resolve) => (finish = resolve)));
    await settled();

    await hold.release();
    expect(disposed).toEqual([]);
    finish();
    await running;
    expect(disposed).toEqual([hold.sessionId]);
  });

  test('an ended observation has nothing for a hold, and disposed every attachment', async () => {
    const { rootSessions } = setup();
    const disposed: string[] = [];
    const observation = rootSessions.observe((session) => ({
      dispose: () => disposed.push(session.sessionId),
    }));
    const hold = await rootSessions.acquire('/repo/infra');

    observation.dispose();
    await expect(runOn(observation, hold)).rejects.toBeInstanceOf(NotObservedError);
    expect(disposed).toEqual([hold.sessionId]);
  });

  test('dispose detaches every observer', async () => {
    const { rootSessions } = setup();
    const { events, observer } = recorder();
    rootSessions.observe(observer);
    const hold = await rootSessions.acquire('/repo/infra');

    await rootSessions.dispose();
    expect(events).toEqual([`attach ${hold.sessionId}`, `detach ${hold.sessionId}`]);
  });
});
