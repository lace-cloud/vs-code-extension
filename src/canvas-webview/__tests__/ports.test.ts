import { describe, expect, test, vi } from 'vitest';
import { fakeEngine, settled } from '../../engine/__tests__/fake-engine';
import type { HostCaller } from '../../protocol/host-protocol';
import { canvasPorts, forwardUnsaved } from '../ports';

function fakeHost(): HostCaller & { notices: unknown[] } {
  const notices: unknown[] = [];
  return {
    notices,
    call: vi.fn(async (name: string) =>
      name === 'confirm' ? true : { root: '', arrangement: {} },
    ) as never,
    notify: (notice) => {
      notices.push(notice);
    },
    onEvent: () => () => {},
  };
}

describe('the ports the page builds', () => {
  test("hold the mapping's ports, the booted arrangement, and the host's dialogs; no auth or navigator", async () => {
    const engine = fakeEngine();
    const host = fakeHost();
    const arrangement = { 'module.root': {} };
    const ports = await canvasPorts(engine.caller, host, { root: '/repo/infra', arrangement });

    expect(ports.context).toEqual({ root: '/repo/infra', sessionId: engine.open()[0] });
    expect(ports.viewState.load()).toBe(arrangement);
    expect(ports.viewState.stack).toBeUndefined();
    expect('auth' in ports).toBe(false);
    expect('navigator' in ports).toBe(false);

    ports.viewState.save({ a: {} });
    ports.presenter.notify('warn', 'careful');
    const failure = { reason: 'source_refused', message: '1 construct could not be converted' };
    ports.presenter.notify('error', 'Error: 1 construct could not be converted', failure);
    expect(host.notices).toEqual([
      { op: 'arrangement', value: { a: {} } },
      { op: 'notify', level: 'warn', text: 'careful' },
      {
        op: 'notify',
        level: 'error',
        text: 'Error: 1 construct could not be converted',
        failure,
      },
    ]);
    expect(await ports.presenter.confirm?.({ text: 'sure?' })).toBe(true);
    expect(host.call).toHaveBeenCalledWith('confirm', { text: 'sure?' });
  });

  test("the canvas's Generate tells the host what the package reads of the tree it wrote, and yields every event as it came", async () => {
    const engine = fakeEngine();
    const host = fakeHost();
    const ports = await canvasPorts(engine.caller, host, { root: '/repo/infra', arrangement: {} });

    const events: string[] = [];
    for await (const event of ports.editor?.generate() ?? []) events.push(event.type);

    expect(events).toEqual(['progress', 'progress', 'success']);
    expect(host.notices).toEqual([
      {
        op: 'generated',
        tree: { changed: ['main.tf'], removed: [], unchanged: 0, treeChanged: true },
      },
    ]);
  });

  test('unsaved is forwarded when it changes', async () => {
    const engine = fakeEngine();
    const host = fakeHost();
    const ports = await canvasPorts(engine.caller, host, { root: '/repo/infra', arrangement: {} });
    forwardUnsaved(ports, host);
    const [id] = engine.open();

    engine.edit(id);
    engine.edit(id);
    await engine.caller.unary('SessionSave', { session_id: id });
    await settled();

    expect(host.notices).toEqual([
      { op: 'unsaved', value: false },
      { op: 'unsaved', value: true },
      { op: 'unsaved', value: false },
    ]);
  });
});
