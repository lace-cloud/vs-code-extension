// src/webview/createWebviewPanel.ts
import * as vscode from 'vscode';
import path from 'path';

import { getWebviewContent } from './getWebviewContent';
import { ServerManager } from '../utilities/engine/server-manager';
import type { HostToWebview, WebviewToHost, Diagnostic } from '../types/protocol';
import { requireClient, handleRpcError } from '../utilities/engine/rpc-errors';

/* ── Constants ── */

const LACE_DIR = '.lace';

/* ── State ── */

let canvasPanel: vscode.WebviewPanel | undefined;

/* ── Public API ── */

/** Get the .lace directory path for the current workspace. */
export function getLaceDir(): string | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return undefined;
  return path.join(workspaceFolder.uri.fsPath, LACE_DIR);
}

/** Drop a module into the active canvas via two-step RPC: fetch deploy_bundle, then apply. */
export async function addModuleToActiveCanvas(
  server: ServerManager,
  name: string,
  system: string,
  version: string,
) {
  if (!canvasPanel) {
    vscode.window.showWarningMessage('No canvas open.');
    return;
  }

  const panel = canvasPanel;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Adding ${name}...` },
    async () => {
      try {
        const client = requireClient(server.rpcClient, 'drop module');

        // Step 1: Fetch deploy bundle from registry
        const versionResult = await client.getRegistryVersion({ name, system, version });
        const deployBundle = versionResult?.deploy_bundle;
        if (!deployBundle) {
          vscode.window.showErrorMessage('Module has no deploy bundle.');
          return;
        }

        // Step 2: Apply deploy bundle to canvas
        const canvasView = await client.dropBundle({ deploy_bundle: deployBundle });
        postToWebview(panel, { command: 'loadState', state: canvasView });
      } catch (err: unknown) {
        handleRpcError(err, 'action/drop_bundle', 'add module to canvas');
      }
    },
  );
}

/** Trigger generate on the active canvas via RPC directly. */
export async function triggerGenerateOnActiveCanvas(server: ServerManager) {
  if (!canvasPanel) {
    vscode.window.showWarningMessage('No canvas open.');
    return;
  }
  const laceDir = getLaceDir();
  if (!laceDir) return;

  try {
    const client = requireClient(server.rpcClient, 'session/generate');
    const result = await client.sessionGenerate({
      output_dir: laceDir,
      options: {
        dry_run: false,
        format: true,
        validate: true,
        overwrite: true,
      },
    });

    const diagnosticErrors = (result?.diagnostics ?? []).filter((d) => d.severity === 'error');
    if (diagnosticErrors.length > 0) {
      postToWebview(canvasPanel, {
        command: 'generateError',
        message: `Generation failed: ${diagnosticErrors.length} error(s)`,
        diagnostics: diagnosticErrors as Diagnostic[],
      });
      return;
    }

    postToWebview(canvasPanel, {
      command: 'generateSuccess',
      files: result?.files_written,
    });

    vscode.window.showInformationMessage(`Terraform generated in ${LACE_DIR}/`);
  } catch (err: unknown) {
    const classified = handleRpcError(err, 'session/generate', 'generate Terraform');
    if (canvasPanel) {
      postToWebview(canvasPanel, {
        command: 'generateError',
        message: classified.message,
      });
    }
  }
}

/* ── Typed message helpers ── */

function postToWebview(panel: vscode.WebviewPanel, msg: HostToWebview) {
  panel.webview.postMessage(msg);
}

// ══════════════════════════════════════════════════════════════════════
// openCanvas — single entry point
// ══════════════════════════════════════════════════════════════════════

export async function openCanvas(context: vscode.ExtensionContext, server: ServerManager) {
  // Already open? Reveal it.
  if (canvasPanel) {
    canvasPanel.reveal();
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('Open a folder first, then run "Lace: Open Canvas".');
    return;
  }

  const workspacePath = workspaceFolder.uri.fsPath;
  const folderName = path.basename(workspacePath);
  const laceDir = path.join(workspacePath, LACE_DIR);

  // ── Create panel ──

  const panel = vscode.window.createWebviewPanel(
    'lace',
    `Lace · ${folderName}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'out')),
        vscode.Uri.joinPath(context.extensionUri, 'images'),
      ],
    },
  );

  canvasPanel = panel;
  panel.webview.html = getWebviewContent(context, panel.webview);

  // ── Host-side dirty tracking + auto-save ──

  let isDirtyHostSide = false;
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleAutoSave() {
    const autoSave = vscode.workspace.getConfiguration('lace').get<boolean>('autoSave', true);
    if (!autoSave) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      try {
        const client = requireClient(server.rpcClient, 'auto-save');
        await client.sessionSave();
        isDirtyHostSide = false;
        panel.title = `Lace · ${folderName}`;
      } catch {
        // Auto-save is best-effort
      }
    }, 2000);
  }

  // ── Session-ready promise (resolves when webviewReady → sessionOpen completes) ──

  let resolveReady: () => void;
  const sessionReady = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const safetyTimeout = setTimeout(resolveReady!, 10_000);

  // ── Message handler ──

  panel.webview.onDidReceiveMessage(
    async (msg: WebviewToHost | { command: string; [key: string]: unknown }) => {
      switch (msg.command) {
        // ── webviewReady: open session via RPC, load canvas state ──
        case 'webviewReady': {
          try {
            const client = requireClient(server.rpcClient, 'session/open');
            const canvasView = await client.sessionOpen({
              file_path: laceDir,
              workspace_name: folderName,
            });
            postToWebview(panel, { command: 'loadState', state: canvasView });
          } catch (err: unknown) {
            const classified = handleRpcError(err, 'session/open', 'open canvas session');
            vscode.window.showErrorMessage(classified.message);
          }
          clearTimeout(safetyTimeout);
          resolveReady();
          break;
        }

        // ── engineCall: forward RPC call from webview, send back result ──
        case 'engineCall': {
          const { requestId, method, params } = msg as {
            requestId: string;
            method: string;
            params?: unknown;
          };
          try {
            const client = requireClient(server.rpcClient, method);
            const result = await client.dispatch(method, params);
            postToWebview(panel, { command: 'engineResult', requestId, result });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            postToWebview(panel, { command: 'engineResult', requestId, error: message });
          }
          break;
        }

        // ── markDirty: update title ──
        case 'markDirty': {
          isDirtyHostSide = true;
          panel.title = `Lace · ${folderName} ●`;
          scheduleAutoSave();
          break;
        }

        // ── markClean: undo restored to saved state ──
        case 'markClean': {
          isDirtyHostSide = false;
          panel.title = `Lace · ${folderName}`;
          break;
        }
      }
    },
  );

  panel.onDidDispose(async () => {
    clearTimeout(safetyTimeout);
    resolveReady();
    if (autoSaveTimer) clearTimeout(autoSaveTimer);

    if (isDirtyHostSide) {
      try {
        const client = server.rpcClient;
        if (client) {
          await client.sessionSave();
        }
      } catch {
        // Best-effort save on close
      }
    }

    try {
      const client = server.rpcClient;
      if (client) {
        await client.sessionClose();
      }
    } catch {
      // Best-effort close
    }

    canvasPanel = undefined;
  });

  return sessionReady;
}
