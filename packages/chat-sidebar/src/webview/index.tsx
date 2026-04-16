import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const vscode = acquireVsCodeApi();
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App vscode={vscode} />);
}
