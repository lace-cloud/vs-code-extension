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
