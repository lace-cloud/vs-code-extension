// src/webview/createWebviewPanel.ts
import * as vscode from 'vscode';
import path from 'path';
import fs from 'fs';

import { randomUUID } from 'crypto';

import { getWebviewContent } from './getWebviewContent';
import { ServerManager } from '../utilities/engine/server-manager';
import { fromBundle, emptyWorkspace, type LayoutHints } from './utils/bundle';
import { validateWorkspace } from './utils/validate';
import type { WorkspaceState } from './types/workspace';
import type { HostToWebview, WebviewToHost, Diagnostic } from '../types/protocol';
import { requireClient, handleRpcError } from '../utilities/engine/rpc-errors';

/* ── Constants ── */

const LACE_DIR = '.lace';
const LACE_FILE = 'lace.json';

/* ── State ── */

let canvasPanel: vscode.WebviewPanel | undefined;

/* ── Pending request map (UUID-keyed, mirrors RPC client pattern) ── */

type PendingWebviewRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingRequests = new Map<string, PendingWebviewRequest>();

const WEBVIEW_REQUEST_TIMEOUT_MS = 5_000;

/* ── Public API ── */

/** Get the .lace directory path for the current workspace. */
export function getLaceDir(): string | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return undefined;
  return path.join(workspaceFolder.uri.fsPath, LACE_DIR);
}

/** Drop a module into the active canvas. Called from sidebar/command palette. */
export function addModuleToActiveCanvas(deploy_bundle: any, icon_url?: string) {
  if (!canvasPanel) {
    vscode.window.showWarningMessage('No canvas open. Run "Lace: Open Canvas" first.');
    return;
  }
  postToWebview(canvasPanel, {
    command: 'dropBundle',
    deploy_bundle,
    icon_url,
  });
}

/** Trigger generate on the active canvas. */
export function triggerGenerateOnActiveCanvas() {
  if (!canvasPanel) {
    vscode.window.showWarningMessage('No canvas open.');
    return;
  }
  postToWebview(canvasPanel, { command: 'triggerGenerate' });
}

/** Send refreshed module defs to the active canvas. */
export function refreshModulesOnActiveCanvas(
  updated_modules: Record<string, import('./types/ir').ModuleDef>,
  icon_updates?: Record<string, string>,
) {
  if (!canvasPanel) {
    vscode.window.showWarningMessage('No canvas open.');
    return;
  }
  postToWebview(canvasPanel, { command: 'refreshModuleDefs', updated_modules, icon_updates });
}

/** Trigger save on the active canvas (webview sends back its current state). */
export function triggerSaveOnActiveCanvas() {
  if (!canvasPanel) return;
  postToWebview(canvasPanel, { command: 'triggerSave' });
}

/** Whether a canvas is currently open. */
export function isCanvasOpen(): boolean {
  return canvasPanel !== undefined;
}

/** Send a request to the webview and wait for a response (UUID-correlated, 5s timeout). */
function makeWebviewRequest<T>(label: string, msg: Omit<HostToWebview, 'requestId'>): Promise<T> {
  if (!canvasPanel) {
    return Promise.reject(new Error('No canvas open'));
  }
  const requestId = randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`${label} timed out`));
    }, WEBVIEW_REQUEST_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, reject, timeout });
    postToWebview(canvasPanel!, { ...msg, requestId } as HostToWebview);
  });
}

/** Request the current graph state from the webview (async, 5s timeout). */
export function requestGraphState(): Promise<WorkspaceState> {
  return makeWebviewRequest<WorkspaceState>('requestGraphState', {
    command: 'getGraphState',
  } as any);
}

/** Dispatch a reducer action to the canvas webview (async, 5s timeout). */
export function dispatchToCanvas(action: import('./state/reducer').WorkspaceAction): Promise<void> {
  return makeWebviewRequest<void>('dispatchToCanvas', {
    command: 'dispatchAction',
    action,
  } as any);
}

/* ── Typed message helpers ── */

function postToWebview(panel: vscode.WebviewPanel, msg: HostToWebview) {
  panel.webview.postMessage(msg);
}

/* ── .lace/ file helpers ── */

function ensureLaceDir(laceDir: string): void {
  if (!fs.existsSync(laceDir)) {
    fs.mkdirSync(laceDir, { recursive: true });
  }
}

function readLaceJson(laceDir: string): any | undefined {
  const filePath = path.join(laceDir, LACE_FILE);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.warn('Failed to read lace.json:', err);
  }
  return undefined;
}

function writeLaceJson(laceDir: string, state: WorkspaceState): void {
  ensureLaceDir(laceDir);
  const filePath = path.join(laceDir, LACE_FILE);
  const tmpPath = filePath + '.tmp';
  const bakPath = filePath + '.bak';

  // Write to temp file first, then atomically rename
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');

  // Rotate: current → .bak (overwrite previous backup)
  try {
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, bakPath);
    }
  } catch {
    // .bak rotation is best-effort
  }

  fs.renameSync(tmpPath, filePath);
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
  let lastKnownState: WorkspaceState | undefined;
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleAutoSave() {
    const autoSave = vscode.workspace.getConfiguration('lace').get<boolean>('autoSave', true);
    if (!autoSave) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      postToWebview(panel, { command: 'triggerSave' });
    }, 2000);
  }

  // ── Message handler ──

  panel.webview.onDidReceiveMessage(
    async (msg: WebviewToHost | { command: string; [key: string]: any }) => {
      switch (msg.command) {
        // ── webviewReady: load .lace/lace.json or create empty workspace ──
        case 'webviewReady': {
          const saved = readLaceJson(laceDir);
          if (saved) {
            // Parse through fromBundle for validation + normalization.
            // Preserve saved layout positions as hints.
            const hints: LayoutHints = {};
            if (saved.layouts) {
              for (const [key, layout] of Object.entries(saved.layouts as Record<string, any>)) {
                hints[key] = {};
                for (const [id, node] of Object.entries(layout.nodes as Record<string, any>)) {
                  hints[key][id] = (node as any).position;
                }
              }
            }
            const { workspace, errors } = fromBundle(saved, hints);
            if (errors.length > 0) {
              console.warn('Bundle parse errors:', errors);
            }
            postToWebview(panel, { command: 'loadState', state: workspace });
          } else {
            // No .lace/lace.json — create empty workspace
            const workspace = emptyWorkspace(folderName);
            writeLaceJson(laceDir, workspace);
            postToWebview(panel, { command: 'loadState', state: workspace });
          }
          break;
        }

        // ── saveState: write to .lace/lace.json ──
        case 'saveState': {
          const state = (msg as any).state as WorkspaceState;
          writeLaceJson(laceDir, state);
          isDirtyHostSide = false;
          lastKnownState = undefined;
          panel.title = `Lace · ${folderName}`;
          postToWebview(panel, { command: 'saveConfirmed' });
          break;
        }

        // ── generateBundle: validate → generate into .lace/ ──
        case 'generateBundle': {
          const m = msg as Extract<WebviewToHost, { command: 'generateBundle' }>;

          // Step 1: Graph validation (local, instant)
          const { workspace: parsedWs } = fromBundle(m.bundle);
          const graphErrors = validateWorkspace(parsedWs);
          if (graphErrors.length > 0) {
            postToWebview(panel, { command: 'validationErrors', errors: graphErrors });
            postToWebview(panel, {
              command: 'generateError',
              message: `Graph validation failed: ${graphErrors.length} error(s)`,
            });
            return;
          }

          // Step 2: Terraform validation (RPC)
          try {
            const client = requireClient(server.rpcClient, 'validate');
            const validateResult = await client.validate({
              bundle: m.bundle,
            });

            const diagnosticErrors = (validateResult?.diagnostics ?? []).filter(
              (d: any) => d.severity === 'error',
            );
            if (diagnosticErrors.length > 0) {
              postToWebview(panel, {
                command: 'generateError',
                message: `Terraform validation failed: ${diagnosticErrors.length} error(s)`,
                diagnostics: diagnosticErrors as Diagnostic[],
              });
              return;
            }
          } catch (err: any) {
            // Validation is a degraded-operation case: warn and proceed
            vscode.window.showWarningMessage(
              'Terraform validation was skipped (engine unavailable). Proceeding with generate.',
            );
          }

          postToWebview(panel, { command: 'validationErrors', errors: [] });

          // Step 3: Generate into .lace/
          ensureLaceDir(laceDir);

          try {
            const client = requireClient(server.rpcClient, 'generate');
            const result = await client.generate({
              bundle: m.bundle,
              outputDir: laceDir,
              options: {
                dryRun: false,
                format: true,
                validate: true,
                overwrite: true,
              },
            });

            postToWebview(panel, {
              command: 'generateSuccess',
              files: result?.filesWritten,
            });

            vscode.window.showInformationMessage(`Terraform generated in ${LACE_DIR}/`);
          } catch (err: any) {
            const classified = handleRpcError(err, 'generate', 'generate Terraform');
            postToWebview(panel, {
              command: 'generateError',
              message: classified.message,
            });
          }
          break;
        }

        // ── refreshModules: relay to command with module keys from webview state ──
        case 'refreshModules': {
          const rm = msg as Extract<WebviewToHost, { command: 'refreshModules' }>;
          vscode.commands.executeCommand('lace.refreshCanvasModules', rm.module_keys);
          break;
        }

        // ── markDirty: update title + mirror state host-side ──
        case 'markDirty': {
          isDirtyHostSide = true;
          lastKnownState = (msg as Extract<WebviewToHost, { command: 'markDirty' }>).state;
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

        // ── graphStateResponse: resolve pending requestGraphState() ──
        case 'graphStateResponse': {
          const { requestId, state } = msg as Extract<
            WebviewToHost,
            { command: 'graphStateResponse' }
          >;
          const pending = pendingRequests.get(requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingRequests.delete(requestId);
            pending.resolve(state);
          }
          break;
        }

        // ── dispatchActionResponse: resolve pending dispatchToCanvas() ──
        case 'dispatchActionResponse': {
          const resp = msg as Extract<WebviewToHost, { command: 'dispatchActionResponse' }>;
          const pending = pendingRequests.get(resp.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingRequests.delete(resp.requestId);
            if (resp.success) {
              pending.resolve(undefined);
            } else {
              pending.reject(new Error(resp.error ?? 'dispatchAction failed'));
            }
          }
          break;
        }
      }
    },
  );

  panel.onDidDispose(async () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);

    // Reject any in-flight requestGraphState / dispatchToCanvas calls
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Canvas panel was closed'));
      pendingRequests.delete(id);
    }

    if (isDirtyHostSide && lastKnownState) {
      writeLaceJson(laceDir, lastKnownState);
    }
    canvasPanel = undefined;
  });
}
