// VS Code webview entry. Constructs PostMessageEngine bound to the VS Code API,
// then hands both to App. Storybook flow decorator uses a different entry
// (ConnectWebEngine + fake VS Code bridge) — see packages/canvas-stories.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { PostMessageEngine } from './post-message-engine';

const vscode = acquireVsCodeApi();
const engine = new PostMessageEngine(vscode);

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(<App engine={engine} vscode={vscode} />);
}
