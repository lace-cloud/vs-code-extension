import { describe, expect, test, vi } from 'vitest';
import { fakeEngine } from '../../engine/__tests__/fake-engine';
import type { HostCaller, PageEvent } from '../../protocol/host-protocol';
import { canvasPage, reportFocus } from '../page';
import { canvasPorts } from '../ports';

function fakeHost() {
  const listeners = new Set<(event: PageEvent) => void>();
  const notices: unknown[] = [];
  const host = {
    call: vi.fn(async () => true) as never,
    notify: (notice) => notices.push(notice),
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies HostCaller;
  return {
    host,
    notices,
    send: (event: PageEvent) => {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

async function booted() {
  const engine = fakeEngine();
  const { host, send, notices } = fakeHost();
  const ports = await canvasPorts(engine.caller, host, { root: '/repo/infra', arrangement: {} });
  return { engine, host, send, notices, ports };
}

describe('the canvas page', () => {
  test('mounts with the booted stack in the context and its own result store', async () => {
    const { host, ports } = await booted();
    const page = canvasPage(host);
    const mounted = vi.fn();
    page.onDidChangePorts(mounted);
    page.mount(ports, { id: 'stk_1', slug: 'prod' });

    expect(mounted).toHaveBeenCalledTimes(1);
    const [shown] = mounted.mock.calls[0];
    expect(shown.context).toEqual({ ...ports.context, stack: { id: 'stk_1', slug: 'prod' } });
    expect(page.results.getTick()).toBe(0);
  });

  test('a pick gives new ports with the new stack and the same source, editor, commands and presenter', async () => {
    const { host, ports, send } = await booted();
    const page = canvasPage(host);
    const shown: (typeof ports)[] = [];
    page.onDidChangePorts((p) => shown.push(p));
    page.mount(ports, undefined);

    send({ op: 'stack', value: { id: 'stk_2', slug: 'staging' } });
    expect(shown).toHaveLength(2);
    const [first, second] = shown;
    expect(first.context.stack).toBeUndefined();
    expect(second.context.stack).toEqual({ id: 'stk_2', slug: 'staging' });
    for (const port of ['source', 'editor', 'commands', 'presenter', 'viewState'] as const) {
      expect(second[port]).toBe(first[port]);
    }
  });

  test('a pick heard before the page mounted wins over the booted stack', async () => {
    const { host, ports, send } = await booted();
    const page = canvasPage(host);
    const shown = vi.fn();
    page.onDidChangePorts(shown);

    send({ op: 'stack', value: { id: 'stk_3', slug: 'dev' } });
    expect(shown).not.toHaveBeenCalled();
    page.mount(ports, { id: 'stk_1', slug: 'prod' });
    expect(shown.mock.calls[0][0].context.stack).toEqual({ id: 'stk_3', slug: 'dev' });
  });

  test('a tick bumps the store and mounts nothing new', async () => {
    const { host, ports, send } = await booted();
    const page = canvasPage(host);
    const shown = vi.fn();
    page.onDidChangePorts(shown);
    page.mount(ports, undefined);

    send({ op: 'tick' });
    send({ op: 'tick' });
    expect(page.results.getTick()).toBe(2);
    expect(shown).toHaveBeenCalledTimes(1);
  });
});

describe('the page focus', () => {
  test('is reported at once and at each focus and blur of the page window', () => {
    const { host, notices } = fakeHost();
    const target = new EventTarget();
    const stop = reportFocus(target, () => false, host);

    target.dispatchEvent(new Event('focus'));
    target.dispatchEvent(new Event('blur'));
    stop();
    target.dispatchEvent(new Event('focus'));

    expect(notices).toEqual([
      { op: 'focus', value: false },
      { op: 'focus', value: true },
      { op: 'focus', value: false },
    ]);
  });
});
