import * as vscode from 'vscode';
import { getWebviewUri } from './getWebviewUri';
import { getWebviewContent } from './getWebviewContent';
import { getComponentIdByName, loadCanvasState, saveCanvasState } from '../database';
import path from 'path';

const panels: Map<string, vscode.WebviewPanel> = new Map();
let autoSaveEnabled = true;

export async function createWebviewPanel(
  componentName: string,
  context: vscode.ExtensionContext
) {
  // Check if a panel already exists
  if (panels.has(componentName)) {
    const panel = panels.get(componentName)!;
    panel.reveal();
    return;
  }

  // Create a new webview panel
  // const panel = vscode.window.createWebviewPanel(
  //   'lace',
  //   componentName,
  //   vscode.ViewColumn.One,
  //   { enableScripts: true }
  // );

  const panel = vscode.window.createWebviewPanel(
    'lace',
    componentName,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'out')),
        vscode.Uri.joinPath(context.extensionUri, 'images')

      ],
    }
  );
  

  panels.set(componentName, panel);

  // Resolve image URIs
  const ec2Uri = getWebviewUri(context, 'EC2.png', panel.webview);
  const s3Uri = getWebviewUri(context, 's3.svg', panel.webview);
  const lambdaUri = getWebviewUri(context, 'lambda.svg', panel.webview);

  console.log(`---s3uri-----${s3Uri}`);

  // Set webview HTML content
  panel.webview.html = getWebviewContent(context, panel.webview, ec2Uri, s3Uri, lambdaUri);

  const componentId = await getComponentIdByName(componentName);
  // if (componentId) {
  //   const canvasState = await loadCanvasState(componentId);
  //   console.log('Loaded canvas state1:', canvasState);
  //   panel.webview.postMessage({ command: 'loadState', state: canvasState });

    
  // }

  let cachedState = null;

if (componentId) {
  cachedState = await loadCanvasState(componentId);
  console.log('cached state loaded:', cachedState);
}

panel.webview.onDidReceiveMessage(async (message) => {
  console.log('EXTENSION RECEIVED:', message.command);

  const componentId = await getComponentIdByName(componentName);
  if (!componentId) return;

  switch (message.command) {
    case 'webviewReady':
      panel.webview.postMessage({
        command: 'loadState',
        state: cachedState ?? { nodes: [], edges: [] },
      });
      break;

    case 'saveState':
      await saveCanvasState(componentId, message.state);
      panel.title = componentName;
      break;

    case 'markDirty':
      panel.title = `${componentName} ●`;
      panel.webview.postMessage({ command: 'triggerSave' });
      break;

    case 'requestLoadState':
      const state = await loadCanvasState(componentId);
      panel.webview.postMessage({
        command: 'loadState',
        state: state ?? { nodes: [], edges: [] },
      });
      break;
  }
});


  // Clean up when the panel is closed
  panel.onDidDispose(() => {
    panels.delete(componentName);
  });
}
