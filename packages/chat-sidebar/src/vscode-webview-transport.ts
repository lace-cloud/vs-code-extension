// VS Code implementation of WebviewTransport.
//
// VS Code's `Webview` already matches the interface shape almost
// exactly — `postMessage` is identical, and `onDidReceiveMessage`
// returns a `vscode.Disposable` that matches our structural one. The
// whole file is thirty lines.

import type { Disposable, HostToWebview, WebviewToHost, WebviewTransport } from '@lace/chat-core';
import type * as vscode from 'vscode';

export function createVsCodeWebviewTransport(webview: vscode.Webview): WebviewTransport {
  return {
    postMessage(message: HostToWebview) {
      // Fire-and-forget; VS Code's Thenable result is ignored both
      // here and in the pre-refactor code.
      webview.postMessage(message);
    },

    onMessage(listener: (message: WebviewToHost) => void): Disposable {
      const subscription = webview.onDidReceiveMessage((msg: WebviewToHost) => listener(msg));
      return { dispose: () => subscription.dispose() };
    },
  };
}
