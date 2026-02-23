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
      gap: 6px;
    }

  </style>
</head>

<body>
  <div id="menu-bar">
  <!-- LEFT: Variables / Outputs / Settings -->
  <div class="menu-left">
    <button id="variables-btn" class="toolbar-btn">Variables</button>
    <button id="outputs-btn" class="toolbar-btn">Outputs</button>
    <button id="terraform-btn" class="toolbar-btn">Terraform</button>
    <button id="providers-btn" class="toolbar-btn">Providers</button>
    <button id="locals-btn" class="toolbar-btn">Locals</button>
    <button id="environments-btn" class="toolbar-btn">Environments</button>
  </div>

  <!-- RIGHT: Save + Generate -->
  <div class="menu-right">
    <button
      id="save-btn"
      style="
        padding: 4px 12px;
        border-radius: 4px;
        background: transparent;
        border: 1px solid rgba(206, 254, 101, 0.3);
        color: #CEFE65;
        font-size: 12px;
        cursor: pointer;
        opacity: 0.4;
        pointer-events: none;
        transition: opacity 0.15s;
      "
      disabled
    >
    Save
    </button>
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

    const tfBtn = document.getElementById('terraform-btn');
    if (tfBtn) {
      tfBtn.addEventListener('click', () => {
        window.postMessage({ command: 'triggerTerraformConfig' }, '*');
      });
    }

    const provBtn = document.getElementById('providers-btn');
    if (provBtn) {
      provBtn.addEventListener('click', () => {
        window.postMessage({ command: 'triggerProviders' }, '*');
      });
    }

    const localsBtn = document.getElementById('locals-btn');
    if (localsBtn) {
      localsBtn.addEventListener('click', () => {
        window.postMessage({ command: 'triggerLocals' }, '*');
      });
    }

    const envsBtn = document.getElementById('environments-btn');
    if (envsBtn) {
      envsBtn.addEventListener('click', () => {
        window.postMessage({ command: 'triggerEnvironments' }, '*');
      });
    }

    // ── Save button ──
    const saveBtn = document.getElementById('save-btn');
    function triggerSave() {
      window.postMessage({ command: 'triggerSave' }, '*');
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', triggerSave);
    }

    // ── Cmd+S / Ctrl+S keyboard shortcut ──
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        triggerSave();
      }
    });

    // ── Listen for dirty/clean state from React app ──
    window.addEventListener('message', (e) => {
      if (e.data?.command === 'setDirty' && saveBtn) {
        const dirty = e.data.dirty;
        saveBtn.style.opacity = dirty ? '1' : '0.4';
        saveBtn.style.pointerEvents = dirty ? 'auto' : 'none';
        saveBtn.disabled = !dirty;
        if (dirty) {
          saveBtn.style.background = 'rgba(206, 254, 101, 0.1)';
          saveBtn.style.borderColor = '#CEFE65';
        } else {
          saveBtn.style.background = 'transparent';
          saveBtn.style.borderColor = 'rgba(206, 254, 101, 0.3)';
        }
      }
    });
  });
  </script>

  <script nonce="${nonce}" src="${reactAppUri}"></script>
</body>
</html>`;
}
