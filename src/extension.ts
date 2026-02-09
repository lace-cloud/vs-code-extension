// src/extension.ts
import * as vscode from 'vscode';
import { ComponentsTreeDataProvider } from './containers-views/ComponentsTreeDataProvider';
import { TemplatesTreeDataProvider } from './containers-views/TemplatesTreeDataProvider';
import {
  setAuthenticationStatus,
  authenticateWithLace,
} from './auth/AuthenticationLace';
import { updateStatusBar } from './statusbar/UpdateStatusBar';
import {
  addComponent,
  getComponents,
  removeComponent,
  initializeDatabase,
} from './database';
import {
  createWebviewPanel,
  closeComponentPanel,
} from './webview/createWebviewPanel';
import { ServerManager } from './utilities/engine/server-manager';
import { syncModulesFromCLI } from './utilities/cli';

let componentsProvider: ComponentsTreeDataProvider | undefined;
let templatesProvider: TemplatesTreeDataProvider | undefined;

let isAuthenticated = false;

// ✅ server will be created in activate()
let server: ServerManager | undefined;

let engineStatusBar: vscode.StatusBarItem | undefined;

/* ---------------------------------- */
/* UI Helpers                          */
/* ---------------------------------- */

function refreshTreeViews(): void {
  componentsProvider?.refresh();
  templatesProvider?.refresh();
}

function refreshUI(): void {
  isAuthenticated = false;

  vscode.authentication
    .getSession('github', ['read:user'], { createIfNone: false })
    .then((session) => {
      isAuthenticated = !!session;
      setAuthenticationStatus(isAuthenticated);
      updateStatusBar();
      refreshTreeViews();
    });
}

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
/* Activate                            */
/* ---------------------------------- */

export async function activate(context: vscode.ExtensionContext) {
  console.log('Lace Extension Activated');

  await syncModulesFromCLI();
  await initializeDatabase();

  // Tree views
  componentsProvider = new ComponentsTreeDataProvider();
  templatesProvider = new TemplatesTreeDataProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('components', componentsProvider),
    vscode.window.registerTreeDataProvider('templates', templatesProvider)
  );

  // Lace Engine
  server = new ServerManager(context);

  engineStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  context.subscriptions.push(engineStatusBar);

  // Server events
  server.on('state', updateEngineStatus);
  server.on('error', (err: Error) =>
    vscode.window.showErrorMessage(`Lace Engine Error: ${err.message}`)
  );

  // Auto-start engine
  if (vscode.workspace.getConfiguration('lace').get<boolean>('autoStart', true)) {
    // don't block activation on startup
    server.start().catch((err) => {
      vscode.window.showErrorMessage(`Failed to start Lace engine: ${err.message}`);
    });
  }

  /* ---------- Commands ---------- */

  context.subscriptions.push(
    vscode.commands.registerCommand('lace.startEngine', () =>
      server?.start()
    ),
    vscode.commands.registerCommand('lace.stopEngine', () =>
      server?.stop()
    ),
    vscode.commands.registerCommand('lace.restartEngine', () =>
      server?.restart()
    ),

    vscode.commands.registerCommand('lace.connect', async () => {
      await authenticateWithLace();
      refreshTreeViews();
    }),

    vscode.commands.registerCommand(
      'components.openComponent',
      async (name: string) => {
        if (!server) {
          vscode.window.showErrorMessage('Lace engine manager not initialized.');
          return;
        }

        // ✅ create webview panel requires server
        await createWebviewPanel(name, context, server);
      }
    ),

    vscode.commands.registerCommand('components.addComponent', async () => {
      if (!isAuthenticated) {
        vscode.window.showErrorMessage('Please connect to Lace first.');
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Enter component name',
      });

      if (!name) return;

      await addComponent(name);
      componentsProvider?.refresh();
    }),

    vscode.commands.registerCommand('components.removeComponent', async () => {
      if (!isAuthenticated) {
        vscode.window.showErrorMessage('Please connect to Lace first.');
        return;
      }

      const components = await getComponents();
      const pick = await vscode.window.showQuickPick(
        components.map((c) => c.name),
        { placeHolder: 'Select component to delete' }
      );

      if (!pick) return;

      const component = components.find((c) => c.name === pick);
      if (!component) return;

      // close webview first
      closeComponentPanel(component.name);

      // delete from DB
      await removeComponent(component.id);

      // refresh tree
      componentsProvider?.refresh();
    })
  );

  // Auth session changes
  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === 'github') refreshUI();
    })
  );

  refreshUI();
}

/* ---------------------------------- */
/* Deactivate                          */
/* ---------------------------------- */

export function deactivate() {
  server?.dispose();
}
