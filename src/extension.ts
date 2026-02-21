// src/extension.ts
import * as vscode from 'vscode';

import { ComponentsTreeDataProvider } from './containers-views/ComponentsTreeDataProvider';
import {
  RegistryBrowserProvider,
  type RegistryModule,
} from './containers-views/RegistryBrowserProvider';

import { updateStatusBar } from './statusbar/UpdateStatusBar';
import { Store } from './persistence';

import {
  createWebviewPanel,
  closeComponentPanel,
  addModuleToActiveCanvas,
  triggerGenerateOnActiveCanvas,
  setStore,
} from './webview/createWebviewPanel';

import { ServerManager } from './utilities/engine/server-manager';

/* ---------------------------------- */
/* State                              */
/* ---------------------------------- */

let store: Store | undefined;
let server: ServerManager | undefined;
let engineStatusBar: vscode.StatusBarItem | undefined;
let registryProvider: RegistryBrowserProvider | undefined;
let componentsProvider: ComponentsTreeDataProvider | undefined;

/* ---------------------------------- */
/* UI Helpers                         */
/* ---------------------------------- */

function updateEngineStatus(state: string) {
  if (!engineStatusBar) return;

  const icon =
    {
      stopped: '$(circle-outline)',
      starting: '$(loading~spin)',
      running: '$(check)',
      error: '$(error)',
    }[state] ?? '$(question)';

  engineStatusBar.text = `${icon} Lace Engine: ${state}`;
  engineStatusBar.show();
}

/* ---------------------------------- */
/* Activate                           */
/* ---------------------------------- */

export async function activate(context: vscode.ExtensionContext) {
  console.log('Lace Extension Activated');

  store = new Store(context.globalStorageUri);
  setStore(store);

  /* ---------- Registry Browser ---------- */

  registryProvider = new RegistryBrowserProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('laceRegistry', registryProvider),
  );

  /* ---------- Components Tree ---------- */

  componentsProvider = new ComponentsTreeDataProvider(store);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('components', componentsProvider),
  );

  /* ---------- Lace Engine ---------- */

  server = new ServerManager(context);

  engineStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(engineStatusBar);

  server.on('state', (state) => {
    updateEngineStatus(state);

    if (state === 'running') {
      // Wire RPC client into registry provider and refresh
      registryProvider?.setRpcClient(server?.rpcClient ?? null);
      registryProvider?.refresh();
    }
  });

  server.on('error', (err: Error) =>
    vscode.window.showErrorMessage(`Lace Engine Error: ${err.message}`),
  );

  if (vscode.workspace.getConfiguration('lace').get<boolean>('autoStart', true)) {
    server.start().catch((err) => {
      vscode.window.showErrorMessage(`Failed to start Lace engine: ${err.message}`);
    });
  }

  /* ---------- Status Bar ---------- */

  updateStatusBar();

  /* ---------- Commands ---------- */

  context.subscriptions.push(
    // ── Engine ──
    vscode.commands.registerCommand('lace.startEngine', () => server?.start()),
    vscode.commands.registerCommand('lace.stopEngine', () => server?.stop()),
    vscode.commands.registerCommand('lace.restartEngine', () => server?.restart()),

    // ── Registry ──
    vscode.commands.registerCommand('lace.refreshRegistry', () => {
      registryProvider?.setRpcClient(server?.rpcClient ?? null);
      registryProvider?.refresh();
    }),

    vscode.commands.registerCommand('lace.showModuleDetail', (mod: RegistryModule) => {
      // For now: show info message. Phase 2: open full detail WebviewPanel.
      const detail = [
        `${mod.name} v${mod.version}`,
        `System: ${mod.system}`,
        `Kind: ${mod.kind}`,
        mod.categories?.length ? `Categories: ${mod.categories.join(', ')}` : '',
        mod.description ?? '',
      ]
        .filter(Boolean)
        .join('\n');

      vscode.window.showInformationMessage(detail, 'Add to Canvas').then((action) => {
        if (action === 'Add to Canvas') {
          dropModuleToCanvas(mod);
        }
      });
    }),

    vscode.commands.registerCommand('lace.addModuleToCanvas', (node: any) => {
      // Called from tree item inline button — node is the TreeNode
      if (node?.module) {
        dropModuleToCanvas(node.module);
      }
    }),

    // ── Command Palette: New Component ──
    vscode.commands.registerCommand('lace.newComponent', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Component name',
        placeHolder: 'my-api-infra',
      });
      if (!name) return;

      store?.addComponent(name);
      componentsProvider?.refresh();

      if (!server) {
        vscode.window.showErrorMessage('Lace engine not initialized.');
        return;
      }
      await createWebviewPanel(name, context, server);
    }),

    // ── Command Palette: Open Component ──
    vscode.commands.registerCommand('lace.openComponent', async () => {
      const components = store?.listComponents() ?? [];
      if (components.length === 0) {
        vscode.window.showInformationMessage('No components. Use "Lace: New Component" first.');
        return;
      }

      const pick = await vscode.window.showQuickPick(
        components.map((c) => c.name),
        { placeHolder: 'Select component to open' },
      );
      if (!pick || !server) return;

      await createWebviewPanel(pick, context, server);
    }),

    // ── Command Palette: Add Module ──
    vscode.commands.registerCommand('lace.addModule', async () => {
      const modules = registryProvider?.getModules() ?? [];
      if (modules.length === 0) {
        vscode.window.showWarningMessage('Registry is empty. Is the Lace engine running?');
        return;
      }

      const items = modules.map((m) => ({
        label: `$(symbol-module) ${m.name}`,
        description: `v${m.version}`,
        detail: `${m.system} · ${m.kind}${m.categories?.length ? ' · ' + m.categories.join(', ') : ''}`,
        module: m,
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Search modules...',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (pick) {
        dropModuleToCanvas(pick.module);
      }
    }),

    // ── Command Palette: Generate ──
    vscode.commands.registerCommand('lace.generate', () => {
      triggerGenerateOnActiveCanvas();
    }),

    // ── Components (existing) ──
    vscode.commands.registerCommand('components.openComponent', async (name: string) => {
      if (!server) {
        vscode.window.showErrorMessage('Lace engine not initialized.');
        return;
      }
      await createWebviewPanel(name, context, server);
    }),

    vscode.commands.registerCommand('components.addComponent', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter component name',
      });
      if (!name) return;

      store?.addComponent(name);
      componentsProvider?.refresh();
    }),

    vscode.commands.registerCommand('components.removeComponent', async () => {
      const components = store?.listComponents() ?? [];
      const pick = await vscode.window.showQuickPick(
        components.map((c) => c.name),
        { placeHolder: 'Select component to delete' },
      );
      if (!pick) return;

      closeComponentPanel(pick);
      store?.removeComponent(pick);
      componentsProvider?.refresh();
    }),
  );
}

/* ---------------------------------- */
/* Helper: drop module to canvas      */
/* ---------------------------------- */

async function dropModuleToCanvas(mod: RegistryModule) {
  if (!server) {
    vscode.window.showErrorMessage('Lace engine not initialized.');
    return;
  }

  try {
    const response = await server.rpcClient?.getRegistryVersion({
      name: mod.name,
      system: mod.system,
      version: mod.version,
    });

    const deploy_bundle = response?.deploy_bundle;
    if (!deploy_bundle) {
      throw new Error('No deploy_bundle in registry response');
    }

    addModuleToActiveCanvas(deploy_bundle);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to fetch module: ${err.message}`);
  }
}

/* ---------------------------------- */
/* Deactivate                         */
/* ---------------------------------- */

export function deactivate() {
  server?.dispose();
}
