// src/webview/getWebviewContent.ts
import * as vscode from 'vscode';
import * as path from 'path';

function getNonce() {
  return Math.random().toString(36).substring(2, 15);
}

export function getWebviewContent(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  ec2Uri: vscode.Uri,
  s3Uri: vscode.Uri,
  lambdaUri: vscode.Uri,
  iamroleUri: vscode.Uri,
  iampolicyUri: vscode.Uri
): string {
  const nonce = getNonce();

  const reactAppUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'out', 'webview.js'))
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />

  <!-- ✅ FINAL, CORRECT CSP -->
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
    }

    .menu-left {
      display: flex;
    }

    .menu-item {
      margin-right: 16px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .menu-item:hover {
      background: #444;
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
  <!-- LEFT: File / Edit / View -->
  <div class="menu-left">
    <div class="menu-item">File</div>
    <div class="menu-item">Edit</div>
    <div class="menu-item">View</div>
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
    // window.vscode = acquireVsCodeApi();

    window.iconPaths = {
      ec2: "${ec2Uri}",
      s3: "${s3Uri}",
      lambda: "${lambdaUri}",
      iam_role: "${iamroleUri}",
      iam_policy: "${iampolicyUri}"
    };

    // 🔹 Generate button handler
  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('generate-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        window.vscode.postMessage({ command: 'generate' });
      });
    }
  });

    // window.vscode.postMessage({ command: 'webviewReady' });
  </script>

  <script nonce="${nonce}" src="${reactAppUri}"></script>
</body>
</html>`;
}
