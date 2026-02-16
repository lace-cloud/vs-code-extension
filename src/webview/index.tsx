import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from 'react-flow-renderer';
import './index.css';
import 'reactflow/dist/style.css';
import App from './App';

// Acquire VS Code API ONCE
// @ts-ignore
const vscode = acquireVsCodeApi();

console.log('✅ Webview JS loaded');

// Expose globally
(window as any).vscode = vscode;

// Handshake
vscode.postMessage({ command: 'webviewReady' });

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>,
  );
}
