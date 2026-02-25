// src/webview/getWebviewContent.ts
import * as vscode from 'vscode';
import * as path from 'path';

function getNonce() {
  return Math.random().toString(36).substring(2, 15);
}

export function getWebviewContent(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
): string {
  const nonce = getNonce();

  const reactAppUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'out', 'webview.js')),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />

  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      img-src ${webview.cspSource} data:;
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src 'nonce-${nonce}';
      connect-src ${webview.cspSource};
    "
  />

  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lace</title>

  <style>
    body {
      margin: 0;
      padding: 0;
      height: 100vh;
      background: #1e1e1e;
      display: flex;
      flex-direction: column;
    }
  </style>
</head>

<body>
  <div id="root"></div>

  <script nonce="${nonce}">
  window.addEventListener('DOMContentLoaded', () => {
    // ── Cmd+S / Ctrl+S keyboard shortcut ──
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        window.postMessage({ command: 'triggerSave' }, '*');
      }
    });
  });
  </script>

  <script nonce="${nonce}" src="${reactAppUri}"></script>
</body>
</html>`;
}
