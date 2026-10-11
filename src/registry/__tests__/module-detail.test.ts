import { describe, expect, test, vi } from 'vitest';
import { fakeCommands, refused, type Script } from '../../engine/__tests__/fake-commands';
import { settled } from '../../engine/__tests__/fake-engine';
import { described, record, row } from '../../protocol/__tests__/registry-fixtures';
import type { DetailState } from '../../protocol/registry-protocol';
import { uri } from '../../roots/__tests__/fake-uri';
import { createModuleDetailPanels } from '../module-detail';
import { registryReads } from '../registry-reads';

function fakePanel() {
  const posted: DetailState[] = [];
  let receive: (message: unknown) => void = () => {};
  let disposed = () => {};
  const panel = {
    reveal: vi.fn(),
    dispose: () => disposed(),
    onDidDispose: (listener: () => void) => {
      disposed = listener;
      return { dispose: () => {} };
    },
    webview: {
      html: '',
      cspSource: 'vscode-webview://csp',
      asWebviewUri: (u: unknown) => u,
      postMessage: async (message: { state: DetailState }) => {
        posted.push(message.state);
        return true;
      },
      onDidReceiveMessage: (listener: (m: unknown) => void) => {
        receive = listener;
        return { dispose: () => {} };
      },
    },
  };
  return { panel, posted, send: (m: unknown) => receive(m) };
}

function setup(answers: Record<string, Script>) {
  const { commands, invoked } = fakeCommands(answers);
  const made: ReturnType<typeof fakePanel>[] = [];
  const api = {
    window: {
      createWebviewPanel: vi.fn(() => {
        const one = fakePanel();
        made.push(one);
        return one.panel;
      }),
    },
    ViewColumn: { Active: -1 },
  };
  const place = vi.fn(async () => {});
  const details = createModuleDetailPanels({
    api: api as never,
    extensionUri: uri('/ext'),
    reads: registryReads(commands),
    place,
    report: () => {},
  });
  return { details, made, invoked, place, api };
}

const VPC = row();

describe('module detail', () => {
  test('one panel per module: showing it again reveals it', () => {
    const { details, made, api } = setup({
      'registry get': { documents: [record()] },
      'registry describe': { documents: [described] },
    });
    details.show(VPC);
    details.show(row({ id: 'man_3', version: '3.0.0' }));
    expect(api.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(made[0].panel.reveal).toHaveBeenCalled();
  });

  test('reads the record, and describes the version the row shows', async () => {
    const { details, invoked, made } = setup({
      'registry get': { documents: [record({ readme: '# VPC' })] },
      'registry describe': { documents: [described] },
    });
    details.show(VPC);
    await settled();
    expect(invoked.map(({ path, args }) => ({ path, args }))).toEqual([
      { path: 'registry get', args: { artifact: 'module/acme/vpc' } },
      { path: 'registry describe', args: { artifact: 'module/acme/vpc', version: 'v2.0.0' } },
    ]);
    made[0].send({ op: 'ready' });
    const last = made[0].posted[made[0].posted.length - 1];
    expect(last.record).toMatchObject({ kind: 'loaded', value: { latest: { readme: '# VPC' } } });
    expect(last.describe).toEqual({ kind: 'loaded', value: described });
  });

  test("a refused describe is drawn by the failure's message, beside a loaded record", async () => {
    const { details, made } = setup({
      'registry get': { documents: [record()] },
      'registry describe': refused({
        reason: 'not_lace_form',
        message: 'acme/vpc 2.0.0 is not in Lace form',
      }),
    });
    details.show(VPC);
    await settled();
    const last = made[0].posted[made[0].posted.length - 1];
    expect(last.describe).toEqual({
      kind: 'failed',
      message: 'acme/vpc 2.0.0 is not in Lace form',
    });
    expect(last.record.kind).toBe('loaded');
  });

  test('Add to Canvas places the version the page names', async () => {
    const { details, made, place } = setup({
      'registry get': { documents: [record()] },
      'registry describe': { documents: [described] },
    });
    details.show(VPC);
    made[0].send({ op: 'place', version: '1.0.0' });
    made[0].send({ op: 'place' });
    expect(place.mock.calls).toEqual([[{ author: 'acme', name: 'vpc', version: '1.0.0' }]]);
  });

  test('serves its page under a CSP that loads https images', () => {
    const { details, made } = setup({
      'registry get': { documents: [record()] },
      'registry describe': { documents: [described] },
    });
    details.show(VPC);
    expect(made[0].panel.webview.html).toMatch(/img-src [^;]*https:/);
    expect(made[0].panel.webview.html).toContain('module-detail.js');
  });
});
