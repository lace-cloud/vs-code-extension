import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import 'reactflow/dist/style.css';
import App from './App';

// Acquire VS Code API ONCE
// @ts-ignore
const vscode = acquireVsCodeApi();

console.log('✅ Webview JS loaded');

// Expose globally
(window as any).vscode = vscode;

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(<App />);
}
