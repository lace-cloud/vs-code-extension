// VS Code-specific webview entry for the chat sidebar.
//
// Rspack bundles this file into `out/chat-sidebar.js`. VS Code loads
// the bundle inside its webview host, which exposes
// `acquireVsCodeApi()` as a global. We wrap it in the generic
// {@link WebviewBridge} contract the pure UI expects, then mount
// the library component. JetBrains (or any other host) would ship
// its own equivalent entry.

import { App, type WebviewBridge, type WebviewToHost } from '@lace-cloud/chat-webview';
import '@lace-cloud/chat-webview/styles.css';
import { createRoot } from 'react-dom/client';

declare global {
  function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  };
}

const vscode = acquireVsCodeApi();
const bridge: WebviewBridge = {
  postMessage: (msg: WebviewToHost) => vscode.postMessage(msg),
};

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App bridge={bridge} />);
}
