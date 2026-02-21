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

    #menu-bar {
      display: flex;
      align-items: center;
      background: #333;
      color: white;
      padding: 6px 10px;
      font-size: 13px;
      gap: 6px;
    }

    .menu-left {
      display: flex;
      gap: 4px;
    }

    .toolbar-btn {
      padding: 4px 10px;
      border-radius: 4px;
      background: #444;
      border: 1px solid #555;
      color: #ccc;
      font-size: 12px;
      cursor: pointer;
    }

    .toolbar-btn:hover {
      background: #555;
      color: white;
    }

    .menu-right {
      margin-left: auto;
      display: flex;
      align-items: center;
    }

  </style>
</head>

<body>
  <div id="menu-bar">
  <!-- LEFT: Variables / Outputs -->
  <div class="menu-left">
    <button id="variables-btn" class="toolbar-btn">Variables</button>
    <button id="outputs-btn" class="toolbar-btn">Outputs</button>
  </div>

  <!-- RIGHT: Generate -->
  <div class="menu-right">
    <button
      id="generate-btn"
      style="
        padding: 4px 12px;
        border-radius: 4px;
        background: #2ea043;
        border: 1px solid #2ea043;
        color: white;
        font-size: 12px;
        cursor: pointer;
      "
    >
    Generate
    </button>
    </div>
  </div>

  <div id="root"></div>

  <script nonce="${nonce}">
  window.addEventListener('DOMContentLoaded', () => {
    const genBtn = document.getElementById('generate-btn');
    if (genBtn) {
      genBtn.addEventListener('click', () => {
        window.postMessage({ command: 'triggerGenerate' }, '*');
      });
    }

    const varsBtn = document.getElementById('variables-btn');
    if (varsBtn) {
      varsBtn.addEventListener('click', () => {
        window.postMessage({ command: 'triggerVariables' }, '*');
      });
    }

    const outsBtn = document.getElementById('outputs-btn');
    if (outsBtn) {
      outsBtn.addEventListener('click', () => {
        window.postMessage({ command: 'triggerOutputs' }, '*');
      });
    }
  });
  </script>

  <script nonce="${nonce}" src="${reactAppUri}"></script>
</body>
</html>`;
}
