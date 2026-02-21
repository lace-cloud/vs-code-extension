// src/webview/createWebviewPanel.ts
import * as vscode from 'vscode';
import path from 'path';
import fs from 'fs';

import { getWebviewContent } from './getWebviewContent';
import { ServerManager } from '../utilities/engine/server-manager';
import { fromBundle, emptyWorkspace, type LayoutHints } from './utils/bundle';
import { validateWorkspace } from './utils/validate';
import type { WorkspaceState } from './types/workspace';
import type { HostToWebview, WebviewToHost, Diagnostic } from '../types/protocol';

/* ── Constants ── */

const LACE_DIR = '.lace';
const LACE_FILE = 'lace.json';

/* ── State ── */

let canvasPanel: vscode.WebviewPanel | undefined;

/* ── Public API ── */

/** Get the .lace directory path for the current workspace. */
export function getLaceDir(): string | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return undefined;
  return path.join(workspaceFolder.uri.fsPath, LACE_DIR);
}

/** Drop a module into the active canvas. Called from sidebar/command palette. */
export function addModuleToActiveCanvas(deploy_bundle: any) {
  if (!canvasPanel) {
    vscode.window.showWarningMessage('No canvas open. Run "Lace: Open Canvas" first.');
    return;
  }
  postToWebview(canvasPanel, {
    command: 'dropBundle',
    deploy_bundle,
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

/** Whether a canvas is currently open. */
export function isCanvasOpen(): boolean {
  return canvasPanel !== undefined;
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
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
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
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'out')),
        vscode.Uri.joinPath(context.extensionUri, 'images'),
      ],
    },
  );

  canvasPanel = panel;
  panel.webview.html = getWebviewContent(context, panel.webview);

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
          panel.title = `Lace · ${folderName}`;
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
            const validateResult = await server.rpcClient?.validate({
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
            console.warn('Terraform validate RPC unavailable, proceeding:', err.message);
          }

          postToWebview(panel, { command: 'validationErrors', errors: [] });

          // Step 3: Generate into .lace/
          ensureLaceDir(laceDir);

          try {
            const result = await server.rpcClient?.generate({
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
            postToWebview(panel, {
              command: 'generateError',
              message: err.message,
            });
            vscode.window.showErrorMessage(err.message);
          }
          break;
        }

        // ── markDirty: update title, trigger save ──
        case 'markDirty': {
          panel.title = `Lace · ${folderName} ●`;
          postToWebview(panel, { command: 'triggerSave' });
          break;
        }
      }
    },
  );

  panel.onDidDispose(() => {
    canvasPanel = undefined;
  });
}
