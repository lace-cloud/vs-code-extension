import * as vscode from 'vscode';
import path from 'path';
import { getWebviewContent } from './getWebviewContent';
import { getWebviewUri } from './getWebviewUri';
import {
  getComponentIdByName,
  loadCanvasState,
  saveCanvasState,
} from '../database';
import { ServerManager } from '../utilities/engine/server-manager';

const panels = new Map<string, vscode.WebviewPanel>();

let activeRegistrySystem: 'aws' | 'azure' | 'gcp' = 'aws';

export function setRegistrySystem(
  system: 'aws' | 'azure' | 'gcp'
) {
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
  server: ServerManager
) {
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

  panel.webview.html = getWebviewContent(
    context,
    panel.webview,
    getWebviewUri(context, 'EC2.png', panel.webview),
    getWebviewUri(context, 's3.svg', panel.webview),
    getWebviewUri(context, 'lambda.svg', panel.webview),
    getWebviewUri(context, 'iam-role.svg', panel.webview),
    getWebviewUri(context, 'iam-policy.svg', panel.webview)
  );

  const componentId = await getComponentIdByName(componentName);
  let cachedState: any = null;

  if (componentId) {
    const raw = await loadCanvasState(componentId);
    cachedState = typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  async function sendRegistryList(system: string) {
    const rpc = server.rpcClient;
    if (!rpc) return;

    const list = await rpc.listRegistryModules({ system });

    panel.webview.postMessage({
      command: 'registryList',
      system,
      modules: list.modules ?? [],
    });
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!componentId) return;

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

      case 'fetchModuleVersion': {
        const data = await server.rpcClient?.getRegistryVersion({
          name: msg.name,
          system: msg.system,
          version: msg.version,
        });

        panel.webview.postMessage({
          command: 'moduleVersionData',
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
