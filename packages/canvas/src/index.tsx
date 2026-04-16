// VS Code webview entry. Constructs PostMessageEngine bound to the VS Code API
// and a thin HostBridge that wraps VS Code's postMessage, then hands both to
// App. Storybook flow decorator uses a different entry (ConnectWebEngine +
// a flow-specific HostBridge) — see packages/canvas-stories.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App, { type HostBridge } from './App';
import { PostMessageEngine } from './post-message-engine';

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
