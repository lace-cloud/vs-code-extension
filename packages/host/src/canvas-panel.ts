import * as vscode from 'vscode';
import * as path from 'path';
import type { ServerManager } from './server-manager';
import type { LaceTransport } from './transport';
import { SubscribeHandler } from './subscribe';
import { requireClient, handleRpcError } from './rpc-errors';
import { buildWebviewHtml } from './webview-html';
import type { CanvasView, HostToWebview, WebviewToHost, Diagnostic } from './types';

const LACE_DIR = '.lace';

let canvasPanel: vscode.WebviewPanel | undefined;
let isGenerating = false;
let latestCanvasView: CanvasView | undefined;
let subscribeHandler: SubscribeHandler | null = null;

function isCanvasView(value: unknown): value is CanvasView {
  return (
    typeof value === 'object' &&
    value !== null &&
    'nodes' in value &&
    Array.isArray((value as CanvasView).nodes)
  );
}

export function getLatestCanvasView(): CanvasView | undefined {
  return latestCanvasView;
}

export function getLaceDir(): string | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return undefined;
  return path.join(workspaceFolder.uri.fsPath, LACE_DIR);
}

function postToWebview(panel: vscode.WebviewPanel, msg: HostToWebview) {
  panel.webview.postMessage(msg);
}

export function publishCanvasViewToActivePanel(state: CanvasView): void {
  if (!canvasPanel) return;
  postToWebview(canvasPanel, { command: 'loadState', state });
}

function requireTransport(server: ServerManager, action: string): LaceTransport {
  return requireClient(server.transport, action);
}

export async function addModuleToActiveCanvas(
  server: ServerManager,
  name: string,
  system: string,
  version: string,
  organization?: string,
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
        const transport = requireTransport(server, 'place module');
        const view = await transport.placeModule({ name, system, version, organization });
        latestCanvasView = view;
        postToWebview(panel, {
          command: 'loadState',
          state: view,
          viewportIntent: { kind: 'fit-all', padding: 0.2, duration: 300 },
        });
      } catch (err: unknown) {
        handleRpcError(err, 'placeModule', 'add module to canvas');
      }
    },
  );
}

export async function triggerGenerateOnActiveCanvas(server: ServerManager) {
  if (!canvasPanel || isGenerating) return;
  const panel = canvasPanel;
  const laceDir = getLaceDir();
  if (!laceDir) return;

  isGenerating = true;
  try {
    postToWebview(panel, { command: 'generateProgress', phase: 'generating' });
    const transport = requireTransport(server, 'session/generate');
    const result = await transport.sessionGenerate({
      output_dir: laceDir,
      options: { dry_run: false, format: true, validate: true, overwrite: true },
    });
    const errors = (result?.diagnostics ?? []).filter((d: Diagnostic) => d.severity === 'error');
    if (errors.length > 0) {
      postToWebview(panel, {
        command: 'generateError',
        message: `Validation: ${errors.length} error(s)`,
        diagnostics: errors,
      });
      return;
    }
    postToWebview(panel, { command: 'generateSuccess', files: result?.files_written });
    vscode.window.showInformationMessage(`Terraform generated in ${LACE_DIR}/`);
  } catch (err: unknown) {
    const classified = handleRpcError(err, 'session/generate', 'generate Terraform');
    if (canvasPanel)
      postToWebview(canvasPanel, { command: 'generateError', message: classified.message });
  } finally {
    isGenerating = false;
  }
}

const CANVAS_KEYBOARD_SHORTCUTS = `
window.addEventListener('DOMContentLoaded', () => {
  function isTextInput(el) { if (!el) return false; const tag = el.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable; }
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); window.dispatchEvent(new CustomEvent('canvasSave')); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); if (window.__canvasUndo) window.__canvasUndo(); }
    if (isTextInput(document.activeElement)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') { e.preventDefault(); if (window.__canvasCopy) window.__canvasCopy(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'x') { e.preventDefault(); if (window.__canvasCut) window.__canvasCut(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') { e.preventDefault(); if (window.__canvasPaste) window.__canvasPaste(); }
  });
});
`.trim();

const CANVAS_BODY_STYLE = `body { margin: 0; padding: 0; height: 100vh; background: #1e1e1e; display: flex; flex-direction: column; }`;

export async function openCanvas(context: vscode.ExtensionContext, server: ServerManager) {
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
  panel.webview.html = buildWebviewHtml(context, panel.webview, {
    scriptFilename: 'webview.js',
    title: 'Lace',
    bodyStyle: CANVAS_BODY_STYLE,
    prebodyScript: CANVAS_KEYBOARD_SHORTCUTS,
  });

  let isDirtyHostSide = false;
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleAutoSave() {
    if (!vscode.workspace.getConfiguration('lace').get<boolean>('autoSave', true)) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      try {
        const transport = server.transport;
        if (transport) {
          await transport.sessionSave();
          isDirtyHostSide = false;
          panel.title = `Lace · ${folderName}`;
        }
      } catch (err) {
        console.error(`[Canvas] auto-save FAILED:`, err);
      }
    }, 2000);
  }

  let resolveReady: () => void;
  const sessionReady = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const safetyTimeout = setTimeout(resolveReady!, 10_000);

  panel.webview.onDidReceiveMessage(
    async (msg: WebviewToHost | { command: string; [key: string]: unknown }) => {
      switch (msg.command) {
        case 'webviewReady': {
          try {
            const transport = requireTransport(server, 'session/open');
            const { view } = await transport.sessionOpen({
              file_path: laceDir,
              workspace_name: folderName,
            });
            latestCanvasView = view;
            postToWebview(panel, { command: 'loadState', state: view });
            const sessionId = transport.sessionId;
            if (sessionId) {
              subscribeHandler = new SubscribeHandler();
              subscribeHandler.start(transport.subscribeStream(sessionId), {
                onStateUpdated: (v) => {
                  latestCanvasView = v;
                  postToWebview(panel, { command: 'loadState', state: v });
                },
                onGenerateProgress: (stage) => {
                  postToWebview(panel, {
                    command: 'generateProgress',
                    phase: stage as 'generating' | 'formatting' | 'validating',
                  });
                },
                onGenerateSuccess: (files) => {
                  postToWebview(panel, { command: 'generateSuccess', files });
                },
                onGenerateError: (message, diagnostics) => {
                  postToWebview(panel, { command: 'generateError', message, diagnostics });
                },
                onEnd: () => {
                  subscribeHandler = null;
                },
                onError: (err) => {
                  console.error('[Subscribe] stream error:', err.message);
                  subscribeHandler = null;
                },
              });
            }
          } catch (err: unknown) {
            console.error(`[Canvas] session/open FAILED:`, err);
            handleRpcError(err, 'session/open', 'open canvas session');
          }
          clearTimeout(safetyTimeout);
          resolveReady();
          break;
        }
        case 'engineCall': {
          const { requestId, method, params } = msg as {
            requestId: string;
            method: string;
            params?: unknown;
          };
          try {
            const transport = requireTransport(server, method);
            const result = await transport.dispatch(method, params);
            if (isCanvasView(result)) latestCanvasView = result;
            postToWebview(panel, { command: 'engineResult', requestId, result });
          } catch (err: unknown) {
            postToWebview(panel, {
              command: 'engineResult',
              requestId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }
        case 'markDirty': {
          isDirtyHostSide = true;
          panel.title = `Lace · ${folderName} ●`;
          scheduleAutoSave();
          break;
        }
        case 'markClean': {
          isDirtyHostSide = false;
          panel.title = `Lace · ${folderName}`;
          break;
        }
        case 'generate': {
          triggerGenerateOnActiveCanvas(server);
          break;
        }
        case 'openFile': {
          const { relativePath, line } = msg as {
            command: string;
            relativePath: string;
            line?: number;
          };
          try {
            const uri = vscode.Uri.file(path.join(laceDir, relativePath));
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
            if (line != null) {
              const ln = Math.max(0, line - 1);
              const lineStart = new vscode.Position(ln, 0);
              const lineEnd = new vscode.Position(ln, Number.MAX_SAFE_INTEGER);
              editor.selection = new vscode.Selection(lineStart, lineEnd);
              editor.revealRange(
                new vscode.Range(lineStart, lineEnd),
                vscode.TextEditorRevealType.InCenter,
              );
            }
          } catch (err) {
            console.error(`[Canvas] openFile failed:`, err);
          }
          break;
        }
      }
    },
  );

  panel.onDidDispose(async () => {
    clearTimeout(safetyTimeout);
    resolveReady();
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    subscribeHandler?.stop();
    subscribeHandler = null;
    const transport = server.transport;
    if (isDirtyHostSide && transport) {
      try {
        await transport.sessionSave();
      } catch (err) {
        console.error(`[Canvas] dispose save FAILED:`, err);
      }
    }
    if (transport) {
      try {
        await transport.sessionClose();
      } catch {
        /* best-effort */
      }
    }
    canvasPanel = undefined;
  });

  return sessionReady;
}
