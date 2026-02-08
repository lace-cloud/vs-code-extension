import * as vscode from 'vscode';
import { getWebviewUri } from './getWebviewUri';
import { getWebviewContent } from './getWebviewContent';
import {
  getComponentIdByName,
  loadCanvasState,
  saveCanvasState
} from '../database';
import path from 'path';

/**
 * 🔑 Central registry of open component panels
 */
const panels: Map<string, vscode.WebviewPanel> = new Map();

/**
 * Open (or reveal) a component webview
 */
export async function createWebviewPanel(
  componentName: string,
  context: vscode.ExtensionContext
) {
  // 🔁 If already open, just reveal
  if (panels.has(componentName)) {
    panels.get(componentName)!.reveal();
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'lace',
    componentName,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'out')),
        vscode.Uri.joinPath(context.extensionUri, 'images'),
      ],
    }
  );

  panels.set(componentName, panel);

  // Resolve image URIs
  const ec2Uri = getWebviewUri(context, 'EC2.png', panel.webview);
  const s3Uri = getWebviewUri(context, 's3.svg', panel.webview);
  const lambdaUri = getWebviewUri(context, 'lambda.svg', panel.webview);
  const iamUri = getWebviewUri(context, 'iam-role.svg', panel.webview);
  const iamPolicyUri = getWebviewUri(context, 'iam-policy.svg', panel.webview);

  panel.webview.html = getWebviewContent(
    context,
    panel.webview,
    ec2Uri,
    s3Uri,
    lambdaUri,
    iamUri,
    iamPolicyUri
  );

  const componentId = await getComponentIdByName(componentName);
  let cachedState = null;

  if (componentId) {
    cachedState = await loadCanvasState(componentId);
  }

  panel.webview.onDidReceiveMessage(async (message) => {
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

  // 🧹 Cleanup on close
  panel.onDidDispose(() => {
    panels.delete(componentName);
  });
}

/**
 * 🔥 CLOSE an open component panel (used on delete)
 */
export function closeComponentPanel(componentName: string) {
  const panel = panels.get(componentName);
  if (panel) {
    panel.dispose();
    panels.delete(componentName);
  }
}
