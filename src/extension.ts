// src/extension.ts
import * as vscode from 'vscode';

import { RegistrySidebarProvider } from './containers-views/RegistrySidebarProvider';
import type { RegistryModule } from './types/protocol';

import { showModuleDetail } from './webview/ModuleDetailPanel';

import {
  openCanvas,
  addModuleToActiveCanvas,
  triggerGenerateOnActiveCanvas,
  getLaceDir,
  isCanvasOpen,
} from './webview/createWebviewPanel';

import { ServerManager } from './utilities/engine/server-manager';

/* ---------------------------------- */
/* State                              */
/* ---------------------------------- */

let server: ServerManager | undefined;
let engineStatusBar: vscode.StatusBarItem | undefined;
let registryProvider: RegistrySidebarProvider | undefined;

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

/** Run a lace CLI terraform command in the integrated terminal. */
function runTerraformCommand(subcommand: string, extraArgs: string[] = []) {
  const laceDir = getLaceDir();
  if (!laceDir) {
    vscode.window.showErrorMessage('Open a folder first.');
    return;
  }

  const binaryPath = vscode.workspace.getConfiguration('lace').get<string>('binaryPath', 'lace');

  const args = ['terraform', subcommand, '--path', laceDir, ...extraArgs];
  const terminal = vscode.window.createTerminal({
    name: `Lace: terraform ${subcommand}`,
    cwd: laceDir,
  });
  terminal.show();
  terminal.sendText(`${binaryPath} ${args.join(' ')}`);
}

/* ---------------------------------- */
/* Activate                           */
/* ---------------------------------- */

export async function activate(context: vscode.ExtensionContext) {
  console.log('Lace Extension Activated');

  /* ---------- Registry Browser (sidebar) ---------- */

  registryProvider = new RegistrySidebarProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RegistrySidebarProvider.viewType, registryProvider),
  );

  /* ---------- Lace Engine ---------- */

  server = new ServerManager();

  engineStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(engineStatusBar);

  server.on('state', (state) => {
    updateEngineStatus(state);

    if (state === 'running') {
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

  /* ---------- Commands ---------- */

  context.subscriptions.push(
    // ── Engine ──
    vscode.commands.registerCommand('lace.startEngine', () => server?.start()),
    vscode.commands.registerCommand('lace.stopEngine', () => server?.stop()),
    vscode.commands.registerCommand('lace.restartEngine', () => server?.restart()),

    // ── Canvas (single entry point) ──
    vscode.commands.registerCommand('lace.openCanvas', async () => {
      if (!server) {
        vscode.window.showErrorMessage('Lace engine not initialized.');
        return;
      }
      await openCanvas(context, server);
    }),

    // ── Registry: refresh ──
    vscode.commands.registerCommand('lace.refreshRegistry', () => {
      registryProvider?.setRpcClient(server?.rpcClient ?? null);
      registryProvider?.refresh();
    }),

    // ── Registry: click module in sidebar → detail panel ──
    vscode.commands.registerCommand('lace.showModuleDetail', (mod: RegistryModule) => {
      showModuleDetail(mod, server?.rpcClient ?? null, addModuleToActiveCanvas);
    }),

    // ── Registry: inline "+" button → add to canvas ──
    vscode.commands.registerCommand('lace.addModuleToCanvas', async (node: any) => {
      if (!node?.module) return;

      // Open canvas first if not already open
      if (!isCanvasOpen() && server) {
        await openCanvas(context, server);
        // Small delay for webview to initialize
        await new Promise((r) => setTimeout(r, 500));
      }

      dropModuleToCanvas(node.module);
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
        placeHolder: 'Search modules to add...',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (pick) {
        // Open canvas first if not already open
        if (!isCanvasOpen() && server) {
          await openCanvas(context, server);
          await new Promise((r) => setTimeout(r, 500));
        }
        dropModuleToCanvas(pick.module);
      }
    }),

    // ── Command Palette: Generate Terraform ──
    vscode.commands.registerCommand('lace.generate', () => {
      triggerGenerateOnActiveCanvas();
    }),

    // ── Terraform commands (shell out to CLI) ──
    vscode.commands.registerCommand('lace.terraformValidate', () => {
      runTerraformCommand('validate');
    }),

    vscode.commands.registerCommand('lace.terraformFmt', () => {
      runTerraformCommand('fmt');
    }),

    vscode.commands.registerCommand('lace.terraformScan', () => {
      runTerraformCommand('scan');
    }),

    vscode.commands.registerCommand('lace.terraformDocs', () => {
      runTerraformCommand('docs');
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

    addModuleToActiveCanvas(deploy_bundle, mod.icon_url);
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
