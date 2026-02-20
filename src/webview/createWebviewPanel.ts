// src/webview/createWebviewPanel.ts
import * as vscode from 'vscode';
import path from 'path';
import fs from 'fs';

import { getWebviewContent } from './getWebviewContent';
import { getWebviewUri } from './getWebviewUri';

import {
  getComponentIdByName,
  loadCanvasState,
  saveCanvasState,
  saveBundleState,
} from '../database';

import { ServerManager } from '../utilities/engine/server-manager';

const panels = new Map<string, vscode.WebviewPanel>();

let activeRegistrySystem: 'aws' | 'azure' | 'gcp' = 'aws';

export function setRegistrySystem(system: 'aws' | 'azure' | 'gcp') {
  activeRegistrySystem = system;

  for (const panel of panels.values()) {
    panel.webview.postMessage({
      command: 'setRegistrySystem',
      system,
    });
  }
}

export async function createWebviewPanel(
  componentName: string,
  context: vscode.ExtensionContext,
  server: ServerManager,
) {
  if (panels.has(componentName)) {
    panels.get(componentName)!.reveal();
    return;
  }

  const panel = vscode.window.createWebviewPanel('lace', componentName, vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.file(path.join(context.extensionPath, 'out')),
      vscode.Uri.joinPath(context.extensionUri, 'images'),
    ],
  });

  panels.set(componentName, panel);

  panel.webview.html = getWebviewContent(
    context,
    panel.webview,
    getWebviewUri(context, 'EC2.png', panel.webview),
    getWebviewUri(context, 's3.svg', panel.webview),
    getWebviewUri(context, 'lambda.svg', panel.webview),
    getWebviewUri(context, 'iam-role.svg', panel.webview),
    getWebviewUri(context, 'iam-policy.svg', panel.webview),
  );

  const componentId = await getComponentIdByName(componentName);
  let cachedState: any = null;

  if (componentId) {
    const raw = await loadCanvasState(componentId);
    cachedState = typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  async function sendRegistryList(system: string) {
    const rpc = server.rpcClient;
    if (!rpc) {
      return;
    }

    const list = await rpc.listRegistryModules({ system });

    console.log(list.modules);

    panel.webview.postMessage({
      command: 'registryList',
      system,
      modules: list.modules ?? [],
    });
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!componentId) {
      return;
    }

    switch (msg.command) {
      case 'webviewReady':
        panel.webview.postMessage({
          command: 'loadState',
          state: cachedState ?? { nodes: [], edges: [] },
        });
        await sendRegistryList(activeRegistrySystem);
        break;

      case 'requestRegistryModules':
        await sendRegistryList(msg.system);
        break;

      /* ------------------------------------------------ */
      /* ✅ GENERATE INTO generate-$componentName FOLDER */
      /* ------------------------------------------------ */
      case 'generateBundle': {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showErrorMessage('No workspace open.');
          return;
        }

        const workspacePath = workspaceFolder.uri.fsPath;

        // 🔥 Create folder: generate-$componentName
        const outputDir = path.join(workspacePath, `generate-${componentName}`);

        // Ensure directory exists
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Save bundle JSON to DB
        await saveBundleState(componentId, msg.bundle);

        try {
          const result = await server.rpcClient?.generate({
            bundle: msg.bundle,
            outputDir,
            options: {
              dryRun: false,
              format: true,
              validate: true,
              overwrite: true,
            },
          });

          panel.webview.postMessage({
            command: 'generateSuccess',
            files: result?.filesWritten,
          });

          vscode.window.showInformationMessage(`Generated in ${path.basename(outputDir)}`);
        } catch (err: any) {
          vscode.window.showErrorMessage(err.message);
        }

        break;
      }

      /* ------------------------------------------------ */

      case 'fetchModuleVersion': {
        const data = await server.rpcClient?.getRegistryVersion({
          name: msg.name,
          system: msg.system,
          version: msg.version,
        });

        console.log(JSON.stringify(data));

        panel.webview.postMessage({
          command: 'moduleVersionData',
          requestId: msg.requestId,
          data,
        });
        break;
      }

      case 'fetchModuleInfo': {
        const data = await server.rpcClient?.getRegistryModule({
          name: msg.name,
          system: msg.system,
        });

        panel.webview.postMessage({
          command: 'moduleInfoData',
          requestId: msg.requestId,
          data,
        });
        break;
      }

      case 'saveState':
        await saveCanvasState(componentId, msg.state);
        cachedState = msg.state;
        panel.title = componentName;
        break;

      case 'markDirty':
        panel.title = `${componentName} ●`;
        panel.webview.postMessage({ command: 'triggerSave' });
        break;
    }
  });

  panel.onDidDispose(() => panels.delete(componentName));
}

export function closeComponentPanel(componentName: string) {
  panels.get(componentName)?.dispose();
  panels.delete(componentName);
}
