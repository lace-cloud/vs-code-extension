// A webview page's end of the postMessage pair it shares with its host.
// `acquireVsCodeApi` may be called once per page, so a page calls this
// once.
import type { RawPort } from '../protocol/host-protocol';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

export function pagePort(): RawPort {
  const vscode = acquireVsCodeApi();
  return {
    post: (message) => vscode.postMessage(message),
    onMessage: (listener) => {
      const onMessage = (event: MessageEvent) => listener(event.data);
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    },
  };
}
