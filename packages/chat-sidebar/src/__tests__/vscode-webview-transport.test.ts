import type { HostToWebview, WebviewToHost } from '@lace-cloud/chat-core';
import { describe, expect, test, vi } from 'vitest';
import { createVsCodeWebviewTransport } from '../vscode-webview-transport';

vi.mock('vscode', async () => {
  const { createVscodeMock } = await import('./test-utils/vscode-mock');
  return createVscodeMock();
});

// Minimal vscode.Webview stand-in. The transport only touches
// postMessage + onDidReceiveMessage; nothing else needs to exist.
function fakeWebview() {
  const posted: HostToWebview[] = [];
  let listener: ((msg: WebviewToHost) => void) | null = null;
  return {
    posted,
    fire(msg: WebviewToHost) {
      listener?.(msg);
    },
    webview: {
      postMessage(msg: HostToWebview) {
        posted.push(msg);
        return Promise.resolve(true);
      },
      onDidReceiveMessage(cb: (msg: WebviewToHost) => void) {
        listener = cb;
        return {
          dispose() {
            listener = null;
          },
        };
      },
    },
  };
}

describe('createVsCodeWebviewTransport', () => {
  test('postMessage forwards to vscode.Webview.postMessage', () => {
    const fake = fakeWebview();
    const transport = createVsCodeWebviewTransport(
      fake.webview as unknown as Parameters<typeof createVsCodeWebviewTransport>[0],
    );
    transport.postMessage({ type: 'token', text: 'hello' });
    expect(fake.posted).toEqual([{ type: 'token', text: 'hello' }]);
  });

  test('onMessage subscribes — listener fires when webview emits', () => {
    const fake = fakeWebview();
    const transport = createVsCodeWebviewTransport(
      fake.webview as unknown as Parameters<typeof createVsCodeWebviewTransport>[0],
    );
    const received: WebviewToHost[] = [];
    transport.onMessage((msg) => received.push(msg));

    fake.fire({ type: 'webview-ready' });
    fake.fire({ type: 'user-turn', text: 'hi' });

    expect(received).toEqual([{ type: 'webview-ready' }, { type: 'user-turn', text: 'hi' }]);
  });

  test('disposing the subscription unsubscribes', () => {
    const fake = fakeWebview();
    const transport = createVsCodeWebviewTransport(
      fake.webview as unknown as Parameters<typeof createVsCodeWebviewTransport>[0],
    );
    const received: WebviewToHost[] = [];
    const sub = transport.onMessage((msg) => received.push(msg));

    fake.fire({ type: 'webview-ready' });
    sub.dispose();
    fake.fire({ type: 'cancel-turn' });

    expect(received).toEqual([{ type: 'webview-ready' }]);
  });
});
