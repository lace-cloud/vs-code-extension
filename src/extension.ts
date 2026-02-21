// src/extension.ts
import * as vscode from 'vscode';

import { ComponentsTreeDataProvider } from './containers-views/ComponentsTreeDataProvider';
import { TemplatesTreeDataProvider } from './containers-views/TemplatesTreeDataProvider';
import { RegistrySelectorProvider } from './containers-views/RegistrySelectorProvider';

import { updateStatusBar } from './statusbar/UpdateStatusBar';

import { Store } from './persistence';

import {
  createWebviewPanel,
  closeComponentPanel,
  setRegistrySystem,
  setStore,
} from './webview/createWebviewPanel';

import { ServerManager } from './utilities/engine/server-manager';

/* ---------------------------------- */
/* Providers                          */
/* ---------------------------------- */

let componentsProvider: ComponentsTreeDataProvider | undefined;
let templatesProvider: TemplatesTreeDataProvider | undefined;
let registrySelectorProvider: RegistrySelectorProvider | undefined;

/* ---------------------------------- */
/* State                              */
/* ---------------------------------- */

let store: Store | undefined;
let server: ServerManager | undefined;
let engineStatusBar: vscode.StatusBarItem | undefined;

// single source of truth for registry system
let activeRegistrySystem: 'aws' | 'azure' | 'gcp' = 'aws';

/* ---------------------------------- */
/* UI Helpers                         */
/* ---------------------------------- */

function updateEngineStatus(state: string) {
  if (!engineStatusBar) {
    return;
  }

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

  /* ---------- Tree Views ---------- */

  componentsProvider = new ComponentsTreeDataProvider(store);
  templatesProvider = new TemplatesTreeDataProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('components', componentsProvider),
    vscode.window.registerTreeDataProvider('templates', templatesProvider),
  );

  /* ---------- Registry Selector (INLINE RADIO STYLE) ---------- */

  registrySelectorProvider = new RegistrySelectorProvider(
    () => activeRegistrySystem,
    (system) => {
      activeRegistrySystem = system;

      // notify all open webviews
      setRegistrySystem(system);

      // refresh selector icons
      registrySelectorProvider?.refresh();
    },
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('laceView', registrySelectorProvider),
  );

  /* ---------- Lace Engine ---------- */

  server = new ServerManager(context);

  engineStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(engineStatusBar);

  server.on('state', (state) => {
    updateEngineStatus(state);

    // optional: refresh registry selector on engine restart
    if (state === 'running') {
      setRegistrySystem(activeRegistrySystem);
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
    // Engine
    vscode.commands.registerCommand('lace.startEngine', () => server?.start()),
    vscode.commands.registerCommand('lace.stopEngine', () => server?.stop()),
    vscode.commands.registerCommand('lace.restartEngine', () => server?.restart()),

    // Registry selector command (USED BY TREE ITEMS)
    vscode.commands.registerCommand('registry.selectSystem', (system: 'aws' | 'azure' | 'gcp') => {
      activeRegistrySystem = system;
      setRegistrySystem(system);
      registrySelectorProvider?.refresh();
    }),

    // Components
    vscode.commands.registerCommand('components.openComponent', async (name: string) => {
      if (!server) {
        vscode.window.showErrorMessage('Lace engine manager not initialized.');
        return;
      }

      await createWebviewPanel(name, context, server);
    }),

    vscode.commands.registerCommand('components.addComponent', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter component name',
      });

      if (!name) {
        return;
      }

      store?.addComponent(name);
      componentsProvider?.refresh();
    }),

    vscode.commands.registerCommand('components.removeComponent', async () => {
      const components = store?.listComponents() ?? [];
      const pick = await vscode.window.showQuickPick(
        components.map((c) => c.name),
        { placeHolder: 'Select component to delete' },
      );

      if (!pick) {
        return;
      }

      closeComponentPanel(pick);
      store?.removeComponent(pick);
      componentsProvider?.refresh();
    }),
  );
}

/* ---------------------------------- */
/* Deactivate                         */
/* ---------------------------------- */

export function deactivate() {
  server?.dispose();
}
