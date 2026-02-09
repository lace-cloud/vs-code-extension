// src/panels/createWebviewPanel.ts
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

  /* --------------------------------------------- */
  /* Registry List                                 */
  /* --------------------------------------------- */
  async function sendRegistryList() {
    const rpc = server.rpcClient;

    if (!rpc) {
      panel.webview.postMessage({
        command: 'registryList',
        modules: {},
        error: 'Lace engine not running',
      });
      return;
    }

    const list = await rpc.listRegistryModules();
    console.log('[registry/list]', list);

    const tree: Record<string, any[]> = {};

    for (const m of list.modules ?? []) {
      const categories: string[] =
        Array.isArray(m.categories) && m.categories.length > 0
          ? m.categories
          : ['misc'];

      for (const cat of categories) {
        if (!tree[cat]) tree[cat] = [];
        if (!tree[cat].some((x) => x.id === m.id)) {
          tree[cat].push(m);
        }
      }
    }

    panel.webview.postMessage({
      command: 'registryList',
      modules: tree,
      pagination: list.pagination,
    });
  }

  /* --------------------------------------------- */
  /* Webview messages                              */
  /* --------------------------------------------- */
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!componentId) return;

    switch (msg.command) {
      case 'webviewReady':
        panel.webview.postMessage({
          command: 'loadState',
          state: cachedState ?? { nodes: [], edges: [] },
        });
        await sendRegistryList();
        break;

      case 'fetchModuleVersion': {
        const rpc = server.rpcClient;
        if (!rpc) return;

        const data = await rpc.getRegistryVersion({
          name: msg.name,
          system: msg.system,
          version: msg.version,
        });

        panel.webview.postMessage({
          command: 'moduleVersionData',
          requestId: msg.requestId,
          ok: true,
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
