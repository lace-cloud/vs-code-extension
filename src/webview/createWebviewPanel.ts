// src/webview/createWebviewPanel.ts
import * as vscode from 'vscode';
import path from 'path';
import fs from 'fs';

import { getWebviewContent } from './getWebviewContent';
import { ServerManager } from '../utilities/engine/server-manager';
import { Store } from '../persistence';
import { fromBundle, type LayoutHints } from './utils/bundle';
import { validateWorkspace } from './utils/validate';
import { toTerraformIdentifier } from './utils/identifiers';
import type { WorkspaceState } from './types/workspace';
import type { HostToWebview, WebviewToHost, Diagnostic } from '../types/protocol';

const panels = new Map<string, vscode.WebviewPanel>();

let storeInstance: Store | undefined;

/** The most recently focused canvas panel — used for host-initiated actions. */
let activePanel: vscode.WebviewPanel | undefined;

export function setStore(store: Store) {
  storeInstance = store;
}

/** Drop a module into the currently active canvas. Called from sidebar/command palette. */
export function addModuleToActiveCanvas(deploy_bundle: any) {
  const panel = activePanel ?? [...panels.values()].at(-1);
  if (!panel) {
    vscode.window.showWarningMessage('No canvas open. Create a component first.');
    return;
  }
  postToWebview(panel, {
    command: 'dropBundle',
    requestId: Date.now(),
    deploy_bundle,
  });
}

/** Trigger generate on the active canvas. */
export function triggerGenerateOnActiveCanvas() {
  const panel = activePanel ?? [...panels.values()].at(-1);
  if (!panel) {
    vscode.window.showWarningMessage('No canvas open.');
    return;
  }
  postToWebview(panel, { command: 'triggerGenerate' });
}

// ── Typed message helpers ──

function postToWebview(panel: vscode.WebviewPanel, msg: HostToWebview) {
  panel.webview.postMessage(msg);
}

// ── Empty workspace factory ──

function emptyWorkspace(componentName: string): WorkspaceState {
  const root_id = toTerraformIdentifier(componentName);
  const root_key = `${root_id}@v1.0.0`;
  return {
    schema_version: '1.0',
    kind: 'module_bundle',
    entry: { module_id: root_id, version: 'v1.0.0' },
    modules: {
      [root_key]: {
        schema_version: '1.0',
        kind: 'module_def',
        id: root_id,
        version: 'v1.0.0',
        interface: { inputs: [], outputs: [] },
        impl: {
          kind: 'composite',
          graph: { instances: [], exports: { outputs: {} } },
        },
      },
    },
    layouts: { [root_key]: { nodes: {} } },
  };
}

// ══════════════════════════════════════════════════════════════════════
// createWebviewPanel
// ══════════════════════════════════════════════════════════════════════

export async function createWebviewPanel(
  componentName: string,
  context: vscode.ExtensionContext,
  server: ServerManager,
) {
  if (panels.has(componentName)) {
    panels.get(componentName)!.reveal();
    return;
  }

  const store = storeInstance ?? new Store(context.globalStorageUri);

  const panel = vscode.window.createWebviewPanel('lace', componentName, vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.file(path.join(context.extensionPath, 'out')),
      vscode.Uri.joinPath(context.extensionUri, 'images'),
    ],
  });

  panels.set(componentName, panel);
  panel.webview.html = getWebviewContent(context, panel.webview);

  // Track which panel is active for host-initiated actions
  panel.onDidChangeViewState((e) => {
    if (e.webviewPanel.active) {
      activePanel = panel;
    }
  });
  activePanel = panel;

  // ── Message handler ──

  panel.webview.onDidReceiveMessage(
    async (msg: WebviewToHost | { command: string; [key: string]: any }) => {
      switch (msg.command) {
        // ── webviewReady: load saved state or create empty workspace ──
        case 'webviewReady': {
          const record = store.getComponent(componentName);
          if (record?.workspace_state) {
            // Parse through fromBundle for boundary validation + binding normalization.
            // Extract saved layout positions as hints so they survive the re-parse.
            const saved = record.workspace_state;
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
            // New component — send empty workspace
            postToWebview(panel, { command: 'loadState', state: emptyWorkspace(componentName) });
          }
          break;
        }

        // ── saveState: persist workspace ──
        case 'saveState': {
          const state = (msg as any).state as WorkspaceState;
          store.saveWorkspaceState(componentName, state);
          panel.title = componentName;
          break;
        }

        // ── fetchModuleVersion: call RPC, extract deploy_bundle, send to webview ──
        case 'fetchModuleVersion': {
          const m = msg as Extract<WebviewToHost, { command: 'fetchModuleVersion' }>;
          try {
            const response = await server.rpcClient?.getRegistryVersion({
              name: m.name,
              system: m.system,
              version: m.version,
            });

            // Extract ONLY deploy_bundle from the raw API response
            const deploy_bundle = response?.deploy_bundle;
            if (!deploy_bundle) {
              throw new Error('No deploy_bundle in registry/version response');
            }

            postToWebview(panel, {
              command: 'dropBundle',
              requestId: m.requestId,
              deploy_bundle,
            });
          } catch (err: any) {
            postToWebview(panel, {
              command: 'rpcError',
              requestId: m.requestId,
              message: err.message,
            });
          }
          break;
        }

        // ── generateBundle: validate then send to CLI for Terraform generation ──
        case 'generateBundle': {
          const m = msg as Extract<WebviewToHost, { command: 'generateBundle' }>;
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            postToWebview(panel, {
              command: 'generateError',
              message: 'No workspace folder open.',
            });
            return;
          }

          // ── Step 1: Graph validation (local, instant) ──
          // Reconstruct workspace from the bundle to run graph validation
          const { workspace: parsedWs } = fromBundle(m.bundle);
          const graphErrors = validateWorkspace(parsedWs);
          if (graphErrors.length > 0) {
            postToWebview(panel, {
              command: 'validationErrors',
              errors: graphErrors,
            });
            postToWebview(panel, {
              command: 'generateError',
              message: `Graph validation failed: ${graphErrors.length} error(s)`,
            });
            return;
          }

          // ── Step 2: Terraform validation (RPC, may take seconds) ──
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
            // If validate RPC is not available (older CLI), proceed with generate
            console.warn('Terraform validate RPC failed, proceeding with generate:', err.message);
          }

          // Clear any previous validation errors on success
          postToWebview(panel, { command: 'validationErrors', errors: [] });

          // ── Step 3: Generate ──
          const workspacePath = workspaceFolder.uri.fsPath;
          const outputDir = path.join(workspacePath, `generate-${componentName}`);

          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          try {
            const result = await server.rpcClient?.generate({
              bundle: m.bundle,
              outputDir,
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

            vscode.window.showInformationMessage(`Generated in ${path.basename(outputDir)}`);
          } catch (err: any) {
            postToWebview(panel, {
              command: 'generateError',
              message: err.message,
            });
            vscode.window.showErrorMessage(err.message);
          }
          break;
        }

        // ── markDirty: update panel title, trigger save ──
        case 'markDirty': {
          panel.title = `${componentName} ●`;
          postToWebview(panel, { command: 'triggerSave' });
          break;
        }
      }
    },
  );

  panel.onDidDispose(() => {
    panels.delete(componentName);
    if (activePanel === panel) {
      activePanel = undefined;
    }
  });
}

export function closeComponentPanel(componentName: string) {
  panels.get(componentName)?.dispose();
  panels.delete(componentName);
}
