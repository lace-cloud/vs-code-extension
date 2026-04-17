import { ChatViewProvider } from '@lace/chat-sidebar';
import * as vscode from 'vscode';
import {
  addModuleToActiveCanvas,
  getLaceDir,
  openCanvas,
  triggerGenerateOnActiveCanvas,
} from './canvas-panel';
import { showModuleDetail } from './module-detail-panel';
import { RegistrySidebarProvider } from './registry-sidebar';
import { ServerManager } from './server-manager';
import type { RegistryModule } from './types';

let server: ServerManager | undefined;
let engineStatusBar: vscode.StatusBarItem | undefined;
let registryProvider: RegistrySidebarProvider | undefined;

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

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

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

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Lace');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine(
    `Lace extension v${context.extension.packageJSON.version ?? 'unknown'} activated (${process.platform})`,
  );

  registryProvider = new RegistrySidebarProvider(context.globalState, outputChannel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RegistrySidebarProvider.viewType, registryProvider),
  );

  server = new ServerManager({
    log: (msg) => outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`),
    getBinaryPath: () =>
      vscode.workspace.getConfiguration('lace').get<string>('binaryPath', '/usr/local/bin/lace'),
    getAutoRestart: () =>
      vscode.workspace.getConfiguration('lace').get<boolean>('autoRestart', true),
  });

  engineStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(engineStatusBar);

  let prevState: string | null = null;
  server.on('state', (state: string) => {
    updateEngineStatus(state);
    if (state === 'running') {
      registryProvider?.setRpcClient(server?.transport ?? null);
      registryProvider?.refresh();
      if (prevState === 'starting') vscode.window.showInformationMessage('Lace engine is running.');
    } else if (state === 'error') {
      vscode.window.showErrorMessage('Lace engine failed to start. Check the Lace output channel.');
    } else if (state === 'stopped' && prevState === 'running') {
      vscode.window.showInformationMessage('Lace engine stopped.');
    }
    prevState = state;
  });

  server.on('error', (err: Error) =>
    vscode.window.showErrorMessage(`Lace Engine Error: ${err.message}`),
  );

  if (vscode.workspace.getConfiguration('lace').get<boolean>('autoStart', true)) {
    server
      .start()
      .catch((err) =>
        vscode.window.showErrorMessage(`Failed to start Lace engine: ${err.message}`),
      );
  }

  async function openCanvasAndAddModule(
    name: string,
    system: string,
    version: string,
    organization?: string,
  ) {
    await openCanvas(context, server!);
    await addModuleToActiveCanvas(server!, name, system, version, organization);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('lace.startEngine', async () => {
      if (server?.currentState === 'running') {
        vscode.window.showInformationMessage('Lace engine is already running.');
        return;
      }
      try {
        await server?.start();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand('lace.stopEngine', async () => {
      if (server?.currentState === 'stopped') {
        vscode.window.showInformationMessage('Lace engine is already stopped.');
        return;
      }
      await server?.stop();
    }),
    vscode.commands.registerCommand('lace.restartEngine', async () => {
      try {
        await server?.restart();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to restart: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand('lace.openLogs', () => outputChannel.show()),
    vscode.commands.registerCommand('lace.openCanvas', async () => {
      if (!server) {
        vscode.window.showErrorMessage('Lace engine not initialized.');
        return;
      }
      await openCanvas(context, server);
    }),
    vscode.commands.registerCommand('lace.refreshRegistry', () => {
      registryProvider?.setRpcClient(server?.transport ?? null);
      registryProvider?.refresh(true);
    }),
    vscode.commands.registerCommand('lace.showModuleDetail', (mod: RegistryModule) => {
      showModuleDetail(mod, server?.transport ?? null, (name, system, version) => {
        if (server) openCanvasAndAddModule(name, system, version);
      });
    }),
    vscode.commands.registerCommand(
      'lace.addModuleToCanvas',
      async (node: { module?: RegistryModule }) => {
        if (!node?.module || !server) return;
        await openCanvasAndAddModule(node.module.name, node.module.system, node.module.version);
        registryProvider?.trackRecentlyUsed(node.module.id);
      },
    ),
    vscode.commands.registerCommand('lace.addModule', async () => {
      const modules = registryProvider?.getModules() ?? [];
      if (modules.length === 0) {
        vscode.window.showWarningMessage('Registry is empty. Is the Lace engine running?');
        return;
      }
      const items = modules.map((m) => ({
        label: `$(symbol-module) ${m.name}`,
        description: `v${m.version}`,
        detail: `${m.system}${m.categories?.length ? ` · ${m.categories.join(', ')}` : ''}`,
        module: m,
      }));
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Search modules to add...',
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (pick && server) {
        await openCanvasAndAddModule(pick.module.name, pick.module.system, pick.module.version);
        registryProvider?.trackRecentlyUsed(pick.module.id);
      }
    }),
    vscode.commands.registerCommand('lace.generate', () => {
      if (server) triggerGenerateOnActiveCanvas(server);
    }),
    vscode.commands.registerCommand('lace.terraformValidate', () =>
      runTerraformCommand('validate'),
    ),
    vscode.commands.registerCommand('lace.terraformFmt', () => runTerraformCommand('fmt')),
    vscode.commands.registerCommand('lace.terraformScan', () => runTerraformCommand('scan')),
    vscode.commands.registerCommand('lace.terraformDocs', () => runTerraformCommand('docs')),
  );

  // ── Chat sidebar ──
  // The provider creates a ChatController per webview resolution;
  // the controller owns a per-instance ToolRegistry and registers
  // its tools internally. No global tool registration here.
  const chatViewProvider = new ChatViewProvider(context, {
    getRpcClient: () => server?.transport ?? null,
    getRegistryModules: () => registryProvider?.getModules() ?? [],
    getUserOrgs: () => [],
    getLaceDir,
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider),
    vscode.commands.registerCommand('lace.clearChatHistory', () => chatViewProvider.clearHistory()),
  );
}

export function deactivate() {
  server?.dispose();
}
