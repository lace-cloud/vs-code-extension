import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

const vscode = acquireVsCodeApi();

console.log('Webview JS loaded');

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(<App vscode={vscode} />);
}
