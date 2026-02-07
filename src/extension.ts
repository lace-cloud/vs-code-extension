import * as vscode from 'vscode';
import { ComponentsTreeDataProvider } from './containers-views/ComponentsTreeDataProvider';
import { TemplatesTreeDataProvider } from './containers-views/TemplatesTreeDataProvider';
import { setAuthenticationStatus, authenticateWithLace } from './auth/AuthenticationLace';
import { updateStatusBar } from './statusbar/UpdateStatusBar';
import {
  addComponent,
  getComponents,
  removeComponent,
  initializeDatabase
} from './database';
import { createWebviewPanel } from './webview/createWebviewPanel';
import { ServerManager } from './utilities/engine/server-manager';
import { syncModulesFromCLI } from './utilities/cli';

let componentsProvider: ComponentsTreeDataProvider | undefined;
let templatesProvider: TemplatesTreeDataProvider | undefined;

// Auth state
let isAuthenticated = false;

// Lace engine
let server: ServerManager;
let engineStatusBar: vscode.StatusBarItem;

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
    .then(session => {
      isAuthenticated = !!session;
      setAuthenticationStatus(isAuthenticated);
      updateStatusBar();
      refreshTreeViews();
    });
}

function updateEngineStatus(state: string) {
  const icon = {
    stopped: '$(circle-outline)',
    starting: '$(loading~spin)',
    running: '$(check)',
    error: '$(error)'
  }[state];

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

  vscode.window.registerTreeDataProvider('components', componentsProvider);
  vscode.window.registerTreeDataProvider('templates', templatesProvider);

  // Lace Engine
  server = new ServerManager(context);
  engineStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  server.on('stateChange', updateEngineStatus);
  server.on('error', err =>
    vscode.window.showErrorMessage(`Lace Engine Error: ${err.message}`)
  );

  context.subscriptions.push(engineStatusBar);

  if (vscode.workspace.getConfiguration('lace').get<boolean>('autoStart', true)) {
    server.start();
  }

  /* ---------- Commands ---------- */

  context.subscriptions.push(
    vscode.commands.registerCommand('lace.startEngine', () => server.start()),
    vscode.commands.registerCommand('lace.stopEngine', () => server.stop()),
    vscode.commands.registerCommand('lace.restartEngine', () => server.restart()),

    vscode.commands.registerCommand('lace.connect', async () => {
      await authenticateWithLace();
      refreshTreeViews();
    }),

    vscode.commands.registerCommand('components.openComponent', (name: string) =>
      createWebviewPanel(name, context)
    ),

    vscode.commands.registerCommand('components.addComponent', async () => {
      if (!isAuthenticated) {
        vscode.window.showErrorMessage('Please connect to Lace first.');
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Enter component name'
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
        components.map(c => c.name)
      );

      if (!pick) return;

      const component = components.find(c => c.name === pick);
      if (!component) return;

      await removeComponent(component.id);
      componentsProvider?.refresh();
    })
  );

  vscode.authentication.onDidChangeSessions(e => {
    if (e.provider.id === 'github') refreshUI();
  });

  refreshUI();
}

/* ---------------------------------- */
/* Deactivate                          */
/* ---------------------------------- */

export function deactivate() {
  server?.dispose();
}
