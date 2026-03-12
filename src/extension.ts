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
} from './webview/createWebviewPanel';

import { registerChatParticipant } from './chat/participant';

import { ServerManager } from './utilities/engine/server-manager';

/* ---------------------------------- */
/* State                              */
/* ---------------------------------- */

let server: ServerManager | undefined;
let engineStatusBar: vscode.StatusBarItem | undefined;
let registryProvider: RegistrySidebarProvider | undefined;
let selectedOrg: string | null = null;
let userOrgs: Array<{ slug: string; name: string; role: string }> = [];

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

/** Shell-quote a single argument (wrap in single quotes, escape inner quotes). */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
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
  terminal.sendText([binaryPath, ...args].map(shellQuote).join(' '));
}

/* ---------------------------------- */
/* Activate                           */
/* ---------------------------------- */

export async function activate(context: vscode.ExtensionContext) {
  /* ---------- Output Channel ---------- */

  const outputChannel = vscode.window.createOutputChannel('Lace');
  context.subscriptions.push(outputChannel);
  const extVersion = context.extension.packageJSON.version ?? 'unknown';
  outputChannel.appendLine(`Lace extension v${extVersion} activated (${process.platform})`);

  /* ---------- Registry Browser (sidebar) ---------- */

  registryProvider = new RegistrySidebarProvider(context.globalState, outputChannel);
  registryProvider.onOrganizationChange((org) => {
    selectedOrg = org;
    server?.rpcClient?.setOrgContext(org);
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RegistrySidebarProvider.viewType, registryProvider),
  );

  /* ---------- Lace Engine ---------- */

  server = new ServerManager(outputChannel);

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

  server.on(
    'auth',
    (status: {
      authenticated: boolean;
      user?: { name?: string };
      orgs?: Array<{ slug: string; name: string; role: string }>;
    }) => {
      registryProvider?.setAuthenticated(status.authenticated);
      userOrgs = status.orgs ?? [];
      registryProvider?.setOrganizations(userOrgs);
      if (status.authenticated) {
        server?.rpcClient?.setOrgContext(selectedOrg);
        registryProvider?.setRpcClient(server?.rpcClient ?? null);
        registryProvider?.refresh();
      } else {
        selectedOrg = null;
        server?.rpcClient?.setOrgContext(null);
        userOrgs = [];
        registryProvider?.setOrganizations([]);
        registryProvider?.setRpcClient(null);
        registryProvider?.refresh();
      }
    },
  );

  if (vscode.workspace.getConfiguration('lace').get<boolean>('autoStart', true)) {
    server.start().catch((err) => {
      vscode.window.showErrorMessage(`Failed to start Lace engine: ${err.message}`);
    });
  }

  /** Open canvas (if needed) then drop a module onto it. */
  async function openCanvasAndAddModule(name: string, system: string, version: string) {
    await openCanvas(context, server!);
    await addModuleToActiveCanvas(server!, name, system, version);
  }

  /* ---------- Commands ---------- */

  context.subscriptions.push(
    // ── Engine ──
    vscode.commands.registerCommand('lace.startEngine', () => server?.start()),
    vscode.commands.registerCommand('lace.stopEngine', () => server?.stop()),
    vscode.commands.registerCommand('lace.restartEngine', () => server?.restart()),

    vscode.commands.registerCommand('lace.login', async () => {
      if (!server || server.currentState !== 'running') {
        vscode.window.showWarningMessage('Start the Lace engine first.');
        return;
      }
      const token = await vscode.window.showInputBox({
        prompt: 'GitHub Personal Access Token',
        password: true,
        placeHolder: 'ghp_...',
        ignoreFocusOut: true,
      });
      if (!token) return;
      try {
        const result = await server.login(token);
        if (result.success) {
          vscode.window.showInformationMessage(`Logged in as ${result.user?.name ?? 'unknown'}`);
        } else {
          vscode.window.showErrorMessage(`Login failed: ${result.error ?? 'Unknown error'}`);
        }
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Login failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand('lace.logout', async () => {
      if (!server || server.currentState !== 'running') {
        vscode.window.showWarningMessage('Lace engine is not running.');
        return;
      }
      try {
        await server.logout();
        vscode.window.showInformationMessage('Logged out of Lace.');
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Logout failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    // ── Logs ──
    vscode.commands.registerCommand('lace.openLogs', () => outputChannel.show()),

    // ── Canvas (single entry point) ──
    vscode.commands.registerCommand('lace.openCanvas', async () => {
      if (!server) {
        vscode.window.showErrorMessage('Lace engine not initialized.');
        return;
      }
      await openCanvas(context, server);
    }),

    // ── Registry: refresh (force bypasses cache) ──
    vscode.commands.registerCommand('lace.refreshRegistry', () => {
      registryProvider?.setRpcClient(server?.rpcClient ?? null);
      registryProvider?.refresh(true);
    }),

    // ── Registry: click module in sidebar → detail panel ──
    vscode.commands.registerCommand('lace.showModuleDetail', (mod: RegistryModule) => {
      showModuleDetail(mod, server?.rpcClient ?? null, (name, system, version) => {
        if (server) {
          openCanvasAndAddModule(name, system, version);
        }
      });
    }),

    // ── Registry: inline "+" button → add to canvas ──
    vscode.commands.registerCommand(
      'lace.addModuleToCanvas',
      async (node: { module?: RegistryModule }) => {
        if (!node?.module || !server) return;
        const mod = node.module;
        await openCanvasAndAddModule(mod.name, mod.system, mod.version);
        registryProvider?.trackRecentlyUsed(node.module.id);
      },
    ),

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
        detail: `${m.system}${m.categories?.length ? ' · ' + m.categories.join(', ') : ''}`,
        module: m,
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Search modules to add...',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (pick && server) {
        const mod = pick.module;
        await openCanvasAndAddModule(mod.name, mod.system, mod.version);
        registryProvider?.trackRecentlyUsed(pick.module.id);
      }
    }),

    // ── Command Palette: Generate Terraform ──
    vscode.commands.registerCommand('lace.generate', () => {
      if (server) triggerGenerateOnActiveCanvas(server);
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

  /* ---------- Chat Participant (@lace) ---------- */

  context.subscriptions.push(
    registerChatParticipant(context, {
      getRpcClient: () => server?.rpcClient ?? null,
      getRegistryModules: () => registryProvider?.getModules() ?? [],
      getLaceDir,
    }),
  );
}

/* ---------------------------------- */
/* Deactivate                         */
/* ---------------------------------- */

export function deactivate() {
  server?.dispose();
}
