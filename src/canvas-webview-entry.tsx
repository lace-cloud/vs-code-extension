// Canvas webview bootstrap (VS Code-specific).
//
// rspack consumes this as the `out/webview.js` entry. Lives at the
// extension root — not in @lace-cloud/canvas — so the published canvas
// package stays portable to Storybook, portal, and JetBrains hosts
// that don't have `acquireVsCodeApi()`.

import { App, type HostBridge, PostMessageEngine } from '@lace-cloud/canvas';
import { createRoot } from 'react-dom/client';
import './canvas-webview-entry.css';

const vscode = acquireVsCodeApi();
const engine = new PostMessageEngine(vscode);

const hostBridge: HostBridge = {
  signalReady: () => vscode.postMessage({ command: 'webviewReady' }),
  markDirty: () => vscode.postMessage({ command: 'markDirty' }),
  markClean: () => vscode.postMessage({ command: 'markClean' }),
  triggerGenerate: () => vscode.postMessage({ command: 'generate' }),
  openFile: (relativePath, line, column) =>
    vscode.postMessage({ command: 'openFile', relativePath, line, column }),
};

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(<App engine={engine} hostBridge={hostBridge} />);
}
