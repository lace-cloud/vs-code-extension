import * as vscode from 'vscode';
import { getWebviewUri } from './getWebviewUri';
import { getWebviewContent } from './getWebviewContent';
import { getComponentIdByName, loadCanvasState, saveCanvasState } from '../database';

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
  const panel = vscode.window.createWebviewPanel(
    'lace',
    componentName,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panels.set(componentName, panel);

  // Resolve image URIs
  const ec2Uri = getWebviewUri(context, 'EC2.png', panel.webview);
  const s3Uri = getWebviewUri(context, 's3.svg', panel.webview);
  const lambdaUri = getWebviewUri(context, 'lambda.svg', panel.webview);

  // Set webview HTML content
  panel.webview.html = getWebviewContent(context, panel.webview, ec2Uri, s3Uri, lambdaUri);

  const componentId = await getComponentIdByName(componentName);
  if (componentId) {
    const canvasState = await loadCanvasState(componentId);
    console.log('Loaded canvas state:', canvasState);
    panel.webview.postMessage({ command: 'loadState', state: canvasState });
  }

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage(async (message) => {
    const componentId = await getComponentIdByName(componentName);
    if (!componentId) {
      vscode.window.showErrorMessage(`Component "${componentName}" not found.`);
      return;
    }

    if (message.command === 'saveState') {
      try {
        console.log(`Saving state for component: ${componentName}`, message.state);
        await saveCanvasState(componentId, message.state);
        panel.title = componentName; // Remove unsaved indicator
        vscode.window.showInformationMessage('Canvas state saved successfully!');
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to save canvas state: ${err}`);
      }
    }

    if (message.command === 'markDirty') {
      panel.title = `${componentName} ●`; // Indicate unsaved changes
      if (autoSaveEnabled) {
        panel.webview.postMessage({ command: 'triggerSave' });
        console.log('Autosave complete.');
      }
    }

    if (message.command === 'requestLoadState') {
      try {
        const canvasState = await loadCanvasState(componentId);
        panel.webview.postMessage({
          command: 'loadState',
          state: canvasState || { nodes: [], edges: [] },
        });
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to load canvas state: ${err}`);
      }
    }
  });

  // Clean up when the panel is closed
  panel.onDidDispose(() => {
    panels.delete(componentName);
  });
}
