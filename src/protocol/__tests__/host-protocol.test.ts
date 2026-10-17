import { bridgeCaller } from '@lace-cloud/canvas/engine';
import { type EngineTransport, serveEngineBridge } from '@lace-cloud/host';
import { describe, expect, test, vi } from 'vitest';
import {
  type HostHandlers,
  hostCaller,
  noticeOf,
  pageEventOf,
  postEvent,
  type RawPort,
  serveHost,
  splitChannel,
} from '../host-protocol';

// Two ends of one postMessage pair.
function pair(): { a: RawPort; b: RawPort } {
  const toA = new Set<(m: unknown) => void>();
  const toB = new Set<(m: unknown) => void>();
  const end = (mine: Set<(m: unknown) => void>, theirs: Set<(m: unknown) => void>): RawPort => ({
    post: (message) => {
      for (const listener of [...theirs]) listener(message);
    },
    onMessage: (listener) => {
      mine.add(listener);
      return () => mine.delete(listener);
    },
  });
  return { a: end(toA, toB), b: end(toB, toA) };
}

const handlers = (over: Partial<HostHandlers> = {}): HostHandlers => ({
  boot: async () => ({ root: '/repo', arrangement: {} }),
  confirm: async () => true,
  openSource: async () => null,
  importResources: async () => null,
  notice: () => {},
  ...over,
});

describe('one pair, two channels', () => {
  test('an engine frame reaches only the engine listener, a host frame only the host listener', () => {
    const { a, b } = pair();
    const page = splitChannel(a);
    const panel = splitChannel(b);
    const engine = vi.fn();
    const host = vi.fn();
    panel.engine.onMessage(engine);
    panel.host.onMessage(host);

    page.engine.post({ kind: 'abort', id: '1' });
    page.host.post({ kind: 'notice', notice: { op: 'unsaved', value: true } });

    expect(engine).toHaveBeenCalledTimes(1);
    expect(engine).toHaveBeenCalledWith({ kind: 'abort', id: '1' });
    expect(host).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledWith({ kind: 'notice', notice: { op: 'unsaved', value: true } });
  });

  test('a message with no envelope, or an unknown channel, reaches neither listener', () => {
    const { a, b } = pair();
    const panel = splitChannel(b);
    const engine = vi.fn();
    const host = vi.fn();
    panel.engine.onMessage(engine);
    panel.host.onMessage(host);

    a.post({ kind: 'abort', id: '1' });
    a.post({ ch: 'other', frame: {} });
    a.post('text');
    a.post(null);

    expect(engine).not.toHaveBeenCalled();
    expect(host).not.toHaveBeenCalled();
  });

  test('the engine bridge round-trips through its channel unchanged', async () => {
    const calls: string[] = [];
    const transport: EngineTransport = {
      client: {
        makeUnaryRequest(path, _s, _d, _argument, _metadata, callback) {
          calls.push(path);
          callback(null, { server_version: 'x', command_paths: ['module validate'] });
        },
        makeServerStreamRequest() {
          const listeners: Record<string, (value?: unknown) => void> = {};
          setTimeout(() => {
            listeners.data?.({ state: { unsaved: true, tree_hash: 't' } });
            listeners.end?.();
          }, 0);
          return {
            cancel: () => {},
            on(event: string, listener: (value?: unknown) => void) {
              listeners[event] = listener;
            },
          } as never;
        },
      },
      metadata: () => undefined as never,
    };
    const { a, b } = pair();
    const page = splitChannel(a);
    const panel = splitChannel(b);
    const dispose = serveEngineBridge(panel.engine, transport);
    const caller = bridgeCaller(page.engine);

    const initialized = await caller.unary('Initialize', {});
    expect(initialized.command_paths).toEqual(['module validate']);
    expect(calls).toEqual(['/lace.engine.LaceEngine/Initialize']);

    const frames: unknown[] = [];
    for await (const event of caller.stream(
      'Subscribe',
      { session_id: 's' },
      new AbortController().signal,
    )) {
      frames.push(event.state?.unsaved);
    }
    expect(frames).toEqual([true]);
    dispose();
  });
});

describe('the host protocol', () => {
  test('a call resolves with the handler’s answer, and two concurrent calls resolve to their own', async () => {
    const { a, b } = pair();
    const answers = new Map<string, (value: boolean) => void>();
    serveHost(
      b,
      handlers({
        confirm: (spec) => new Promise((resolve) => answers.set(spec.text, resolve)),
      }),
    );
    const host = hostCaller(a);

    const first = host.call('confirm', { text: 'first' });
    const second = host.call('confirm', { text: 'second' });
    answers.get('second')?.(false);
    answers.get('first')?.(true);

    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(await host.call('boot', {})).toEqual({ root: '/repo', arrangement: {} });
  });

  test('a handler that throws rejects the call with its message', async () => {
    const { a, b } = pair();
    serveHost(b, handlers({ boot: () => Promise.reject(new Error('locked')) }));
    await expect(hostCaller(a).call('boot', {})).rejects.toThrow('locked');
  });

  test('a notice reaches the handler; a malformed one does not', () => {
    const { a, b } = pair();
    const notice = vi.fn();
    serveHost(b, handlers({ notice }));
    const host = hostCaller(a);

    host.notify({ op: 'unsaved', value: true });
    host.notify({ op: 'notify', level: 'warn', text: 'careful' });
    a.post({ ch: 'host', frame: { kind: 'notice', notice: { op: 'unsaved', value: 'yes' } } });
    a.post({ ch: 'host', frame: { kind: 'notice', notice: { op: 'open-anything', value: 1 } } });
    a.post({ ch: 'host', frame: { kind: 'call', id: 1, name: 'boot' } });

    expect(notice.mock.calls).toEqual([
      [{ op: 'unsaved', value: true }],
      [{ op: 'notify', level: 'warn', text: 'careful' }],
    ]);
  });

  test('an unknown call or a confirm with no text is refused, never served', async () => {
    const { a, b } = pair();
    const confirm = vi.fn(async () => true);
    serveHost(b, handlers({ confirm }));
    const host = hostCaller(a);

    await expect(
      (host.call as (n: string, r: unknown) => Promise<unknown>)('shutdown', {}),
    ).rejects.toThrow('unknown call: shutdown');
    await expect(host.call('confirm', { text: 1 } as never)).rejects.toThrow('confirm: no text');
    expect(confirm).not.toHaveBeenCalled();
  });

  test('importResources reaches its own handler, and no other', async () => {
    const { a, b } = pair();
    const importResources = vi.fn(async () => null);
    const confirm = vi.fn(async () => true);
    serveHost(b, handlers({ importResources, confirm }));

    expect(await hostCaller(a).call('importResources', {})).toBeNull();
    expect(importResources).toHaveBeenCalledWith({});
    expect(confirm).not.toHaveBeenCalled();
  });

  test('openSource reaches its handler with the file, line and column; one with no file is refused', async () => {
    const { a, b } = pair();
    const openSource = vi.fn(async () => null);
    serveHost(b, handlers({ openSource }));
    const host = hostCaller(a);

    expect(await host.call('openSource', { file: 'main.tf', line: 4, column: 2 })).toBeNull();
    expect(await host.call('openSource', { file: 'variables.tf' })).toBeNull();
    await expect(host.call('openSource', { line: 4 } as never)).rejects.toThrow(
      'openSource: no file',
    );
    await expect(host.call('openSource', { file: 'main.tf', line: '4' } as never)).rejects.toThrow(
      'openSource: no file',
    );
    expect(openSource.mock.calls).toEqual([
      [{ file: 'main.tf', line: 4, column: 2 }],
      [{ file: 'variables.tf' }],
    ]);
  });

  test('noticeOf accepts each notice shape and nothing else', () => {
    expect(noticeOf({ op: 'arrangement', value: { a: {} } })).toEqual({
      op: 'arrangement',
      value: { a: {} },
    });
    expect(noticeOf({ op: 'focus', value: false })).toEqual({ op: 'focus', value: false });
    expect(noticeOf({ op: 'focus', value: 'no' })).toBeNull();
    expect(noticeOf({ op: 'notify', level: 'loud', text: 'x' })).toBeNull();
    const failure = { reason: 'no_team', message: 'no team', url: 'https://portal/teams/new' };
    expect(noticeOf({ op: 'notify', level: 'error', text: 'no team', failure })).toEqual({
      op: 'notify',
      level: 'error',
      text: 'no team',
      failure,
    });
    expect(
      noticeOf({ op: 'notify', level: 'error', text: 'x', failure: { reason: 'no_team' } }),
    ).toBeNull();
    const files = { written: ['main.tf', 'outputs.tf'], changed: ['main.tf'], removed: ['old.tf'] };
    expect(noticeOf({ op: 'generated', files })).toEqual({ op: 'generated', files });
    expect(noticeOf({ op: 'generated', files: { ...files, written: 'main.tf' } })).toBeNull();
    expect(noticeOf({ op: 'generated', files: { ...files, changed: [1] } })).toBeNull();
    expect(noticeOf({ op: 'generated', files: { written: files.written } })).toBeNull();
    expect(noticeOf({ op: 'generated', written: ['main.tf'] })).toBeNull();
    expect(noticeOf({ op: 'arrangement', value: 3 })).toBeNull();
    expect(noticeOf(undefined)).toBeNull();
  });
});

describe('events from the host', () => {
  test('reach every page listener in order; a malformed one reaches none', () => {
    const { a, b } = pair();
    const page = hostCaller(a);
    const heard = vi.fn();
    page.onEvent(heard);

    postEvent(b, { op: 'stack', value: { id: 'stk_1', slug: 'prod' } });
    postEvent(b, { op: 'tick' });
    b.post({ kind: 'event', event: { op: 'stack', value: { id: 1 } } });
    b.post({ kind: 'event', event: { op: 'reload' } });

    expect(heard.mock.calls).toEqual([
      [{ op: 'stack', value: { id: 'stk_1', slug: 'prod' } }],
      [{ op: 'tick' }],
    ]);
  });

  test('pageEventOf accepts a stack with or without a value, and a tick', () => {
    expect(pageEventOf({ op: 'stack' })).toEqual({ op: 'stack' });
    expect(pageEventOf({ op: 'stack', value: { id: 'a', slug: 'b', extra: 1 } })).toEqual({
      op: 'stack',
      value: { id: 'a', slug: 'b' },
    });
    expect(pageEventOf({ op: 'tick' })).toEqual({ op: 'tick' });
    expect(pageEventOf(null)).toBeNull();
  });
});
