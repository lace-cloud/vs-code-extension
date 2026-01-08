// import React from 'react';
// import ReactDOM from 'react-dom';
// import App from './App';
// // import * as serviceWorker from './serviceWorker';

// const rootElement = document.getElementById('root');
// if (rootElement) {
//   ReactDOM.render(<App />, rootElement);
// }



// @ts-ignore
// navigator.serviceWorker = undefined;

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Acquire VS Code API ONCE
// @ts-ignore
const vscode = acquireVsCodeApi();

console.log('✅ Webview JS loaded');

// Expose globally (used in Canvas)
(window as any).vscode = vscode;

// Handshake
vscode.postMessage({ command: 'webviewReady' });

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}





