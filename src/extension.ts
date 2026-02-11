// src/extension.ts
import * as vscode from 'vscode';

import { ComponentsTreeDataProvider } from './containers-views/ComponentsTreeDataProvider';
import { TemplatesTreeDataProvider } from './containers-views/TemplatesTreeDataProvider';
import { RegistrySelectorProvider } from './containers-views/RegistrySelectorProvider';

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
  setRegistrySystem,
} from './webview/createWebviewPanel';

import { ServerManager } from './utilities/engine/server-manager';
// import { syncModulesFromCLI } from './utilities/cli';

/* ---------------------------------- */
/* Providers                          */
/* ---------------------------------- */

let componentsProvider: ComponentsTreeDataProvider | undefined;
let templatesProvider: TemplatesTreeDataProvider | undefined;
let registrySelectorProvider: RegistrySelectorProvider | undefined;

/* ---------------------------------- */
/* State                              */
/* ---------------------------------- */

let isAuthenticated = false;
let server: ServerManager | undefined;
let engineStatusBar: vscode.StatusBarItem | undefined;

// single source of truth for registry system
let activeRegistrySystem: 'aws' | 'azure' | 'gcp' = 'aws';

/* ---------------------------------- */
/* UI Helpers                         */
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
/* Activate                           */
/* ---------------------------------- */

export async function activate(context: vscode.ExtensionContext) {
  console.log('Lace Extension Activated');

  // await syncModulesFromCLI();
  await initializeDatabase();

  /* ---------- Tree Views ---------- */

  componentsProvider = new ComponentsTreeDataProvider();
  templatesProvider = new TemplatesTreeDataProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'components',
      componentsProvider
    ),
    vscode.window.registerTreeDataProvider(
      'templates',
      templatesProvider
    )
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
    }
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'laceView',
      registrySelectorProvider
    )
  );

  /* ---------- Lace Engine ---------- */

  server = new ServerManager(context);

  engineStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  context.subscriptions.push(engineStatusBar);

  server.on('state', (state) => {
    updateEngineStatus(state);

    // optional: refresh registry selector on engine restart
    if (state === 'running') {
      setRegistrySystem(activeRegistrySystem);
    }
  });

  server.on('error', (err: Error) =>
    vscode.window.showErrorMessage(
      `Lace Engine Error: ${err.message}`
    )
  );

  if (
    vscode.workspace
      .getConfiguration('lace')
      .get<boolean>('autoStart', true)
  ) {
    server.start().catch((err) => {
      vscode.window.showErrorMessage(
        `Failed to start Lace engine: ${err.message}`
      );
    });
  }

  /* ---------- Commands ---------- */

  context.subscriptions.push(
    // Engine
    vscode.commands.registerCommand(
      'lace.startEngine',
      () => server?.start()
    ),
    vscode.commands.registerCommand(
      'lace.stopEngine',
      () => server?.stop()
    ),
    vscode.commands.registerCommand(
      'lace.restartEngine',
      () => server?.restart()
    ),

    // Auth
    vscode.commands.registerCommand(
      'lace.connect',
      async () => {
        await authenticateWithLace();
        refreshTreeViews();
      }
    ),

    // Registry selector command (USED BY TREE ITEMS)
    vscode.commands.registerCommand(
      'registry.selectSystem',
      (system: 'aws' | 'azure' | 'gcp') => {
        activeRegistrySystem = system;
        setRegistrySystem(system);
        registrySelectorProvider?.refresh();
      }
    ),

    // Components
    vscode.commands.registerCommand(
      'components.openComponent',
      async (name: string) => {
        if (!server) {
          vscode.window.showErrorMessage(
            'Lace engine manager not initialized.'
          );
          return;
        }

        await createWebviewPanel(name, context, server);
      }
    ),

    vscode.commands.registerCommand(
      'components.addComponent',
      async () => {
        if (!isAuthenticated) {
          vscode.window.showErrorMessage(
            'Please connect to Lace first.'
          );
          return;
        }

        const name = await vscode.window.showInputBox({
          prompt: 'Enter component name',
        });

        if (!name) return;

        await addComponent(name);
        componentsProvider?.refresh();
      }
    ),

    vscode.commands.registerCommand(
      'components.removeComponent',
      async () => {
        if (!isAuthenticated) {
          vscode.window.showErrorMessage(
            'Please connect to Lace first.'
          );
          return;
        }

        const components = await getComponents();
        const pick = await vscode.window.showQuickPick(
          components.map((c) => c.name),
          { placeHolder: 'Select component to delete' }
        );

        if (!pick) return;

        const component = components.find(
          (c) => c.name === pick
        );
        if (!component) return;

        closeComponentPanel(component.name);
        await removeComponent(component.id);
        componentsProvider?.refresh();
      }
    )
  );

  /* ---------- Auth Session ---------- */

  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === 'github') {
        refreshUI();
      }
    })
  );

  refreshUI();
}

/* ---------------------------------- */
/* Deactivate                         */
/* ---------------------------------- */

export function deactivate() {
  server?.dispose();
}
