// Transport abstraction for host↔webview postMessage.
//
// Separate from ChatHostAdapter because webview lifecycle is
// orthogonal to chat logic. VS Code wraps `vscode.Webview`; a
// JetBrains adapter wraps `JBCefBrowser` + `JBCefJSQuery`. Core
// treats both identically.

import type { HostToWebview, WebviewToHost } from './protocol';
import type { Disposable } from './types';

export interface WebviewTransport {
  /** Send a message to the webview. */
  postMessage(message: HostToWebview): void;

  /**
   * Subscribe to messages coming from the webview. Call
   * `dispose()` on the returned value to unsubscribe.
   */
  onMessage(listener: (message: WebviewToHost) => void): Disposable;
}
