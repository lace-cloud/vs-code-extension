// src/webview/createWebviewPanel.ts
import * as vscode from 'vscode';
import path from 'path';
import * as fs from 'fs';

import { getWebviewContent } from './getWebviewContent';
import { ServerManager } from '../utilities/engine/server-manager';
import type { HostToWebview, WebviewToHost, Diagnostic, GeneratePhase } from '../types/protocol';
import type { CanvasView } from './types/render';
import { requireClient, handleRpcError } from '../utilities/engine/rpc-errors';
import * as terraform from '../utilities/terraform';
import { findFreePosition } from './utils/layout';

/* ── Constants ── */

const LACE_DIR = '.lace';

/* ── State ── */

let canvasPanel: vscode.WebviewPanel | undefined;
let isGenerating = false;
let latestCanvasView: CanvasView | undefined;

/** Cheap runtime check: does this look like a CanvasView? */
function isCanvasView(value: unknown): value is CanvasView {
  return (
    typeof value === 'object' &&
    value !== null &&
    'nodes' in value &&
    Array.isArray((value as CanvasView).nodes)
  );
}

/** Returns the latest known CanvasView from the host cache. */
export function getLatestCanvasView(): CanvasView | undefined {
  return latestCanvasView;
}

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

        // Step 2: Apply deploy bundle to canvas, positioned after existing nodes
        const position = findFreePosition(latestCanvasView?.nodes ?? []);
        const canvasView = await client.dropBundle({ deploy_bundle: deployBundle, position });
        latestCanvasView = canvasView;
        postToWebview(panel, { command: 'loadState', state: canvasView });
      } catch (err: unknown) {
        handleRpcError(err, 'action/drop_bundle', 'add module to canvas');
      }
    },
  );
}

/** Trigger generate on the active canvas via RPC, then format + validate locally. */
export async function triggerGenerateOnActiveCanvas(server: ServerManager) {
  if (!canvasPanel || isGenerating) return;
  const panel = canvasPanel;
  const laceDir = getLaceDir();
  if (!laceDir) return;

  isGenerating = true;

  function postProgress(phase: GeneratePhase) {
    postToWebview(panel, { command: 'generateProgress', phase });
  }

  try {
    // Phase 1: Generate files (no fmt/validate — we do that locally)
    postProgress('generating');
    const client = requireClient(server.rpcClient, 'session/generate');
    const result = await client.sessionGenerate({
      output_dir: laceDir,
      options: { dry_run: false, format: false, validate: false, overwrite: true },
    });

    const filesWritten = result?.files_written ?? [];

    // Check if terraform is available for fmt/validate phases
    const hasTerraform = await terraform.isAvailable();

    if (hasTerraform && filesWritten.length > 0) {
      // Phase 2: Format
      postProgress('formatting');
      await terraform.format(filesWritten);

      // Phase 3: Validate
      postProgress('validating');
      const validation = await terraform.validate(laceDir);

      if (validation === null) {
        // validate produced no output at all — treat as unknown, not clean
        postToWebview(panel, {
          command: 'generateError',
          message: 'Validation could not run — terraform validate produced no output.',
        });
        return;
      }

      if (!validation.valid) {
        const errors = validation.diagnostics.filter((d) => d.severity === 'error');
        if (errors.length > 0) {
          const enriched = enrichDiagnosticsWithAddress(errors as Diagnostic[], laceDir);
          postToWebview(panel, {
            command: 'generateError',
            message: `Validation: ${errors.length} error(s)`,
            diagnostics: enriched,
          });
          return;
        }
      }
    } else if (!hasTerraform) {
      vscode.window.showInformationMessage(
        'Terraform not found — files generated, but formatting/validation skipped.',
      );
    }

    postToWebview(panel, { command: 'generateSuccess', files: filesWritten });
    vscode.window.showInformationMessage(`Terraform generated in ${LACE_DIR}/`);
  } catch (err: unknown) {
    const classified = handleRpcError(err, 'session/generate', 'generate Terraform');
    if (canvasPanel) {
      postToWebview(canvasPanel, { command: 'generateError', message: classified.message });
    }
  } finally {
    isGenerating = false;
  }
}

/* ── Diagnostic enrichment ── */

/**
 * For diagnostics pointing at the root main.tf with no address, resolve the
 * module name by finding which `module "X" {` block the error line falls in.
 */
function enrichDiagnosticsWithAddress(diags: Diagnostic[], laceDir: string): Diagnostic[] {
  // Build a line→moduleName map lazily from main.tf
  let moduleRanges: Array<{ name: string; start: number; end: number }> | null = null;

  function getModuleRanges() {
    if (moduleRanges !== null) return moduleRanges;
    moduleRanges = [];
    try {
      const mainTf = fs.readFileSync(path.join(laceDir, 'main.tf'), 'utf8');
      const lines = mainTf.split('\n');
      let current: { name: string; start: number } | null = null;
      let depth = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!current) {
          const m = line.match(/^\s*module\s+"([^"]+)"\s*\{/);
          if (m) {
            current = { name: m[1], start: i + 1 };
            depth = 1;
          }
        } else {
          for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
          }
          if (depth <= 0) {
            moduleRanges.push({ name: current.name, start: current.start, end: i + 1 });
            current = null;
            depth = 0;
          }
        }
      }
    } catch {
      /* main.tf unreadable — leave ranges empty */
    }
    return moduleRanges;
  }

  return diags.map((d) => {
    if (d.address || !d.file?.endsWith('main.tf') || d.line == null) return d;
    const ranges = getModuleRanges();
    const match = ranges.find((r) => d.line! >= r.start && d.line! <= r.end);
    if (!match) return d;
    return { ...d, address: `module.${match.name}` };
  });
}

/* ── Typed message helpers ── */

function postToWebview(panel: vscode.WebviewPanel, msg: HostToWebview) {
  panel.webview.postMessage(msg);
}

/** Push a fresh CanvasView to the active panel (if open). */
export function publishCanvasViewToActivePanel(state: CanvasView): void {
  if (!canvasPanel) return;
  postToWebview(canvasPanel, { command: 'loadState', state });
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
      } catch (err) {
        console.error(`[Canvas] auto-save FAILED:`, err);
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
            latestCanvasView = canvasView;
            postToWebview(panel, { command: 'loadState', state: canvasView });
          } catch (err: unknown) {
            console.error(`[Canvas] session/open FAILED:`, err);
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
            // Keep latestCanvasView in sync with any RPC that returns a CanvasView
            if (isCanvasView(result)) {
              latestCanvasView = result;
            }
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

        // ── generate: delegate to host-side function ──
        case 'generate': {
          triggerGenerateOnActiveCanvas(server);
          break;
        }

        // ── markClean: undo restored to saved state ──
        case 'markClean': {
          isDirtyHostSide = false;
          panel.title = `Lace · ${folderName}`;
          break;
        }

        // ── openChat: open @lace chat with prefilled prompt ──
        case 'openChat': {
          const { prompt } = msg as { command: string; prompt: string };
          await vscode.commands.executeCommand('workbench.action.chat.open', {
            query: prompt,
          });
          break;
        }

        // ── openFile: open a generated .tf file at a specific line ──
        case 'openFile': {
          const { relativePath, line } = msg as {
            command: string;
            relativePath: string;
            line?: number;
            column?: number;
          };
          try {
            const absPath = path.join(laceDir, relativePath);
            const uri = vscode.Uri.file(absPath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
            if (line != null) {
              const ln = Math.max(0, line - 1);
              // Select the full line so it highlights blue in the editor
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

    if (isDirtyHostSide) {
      try {
        const client = server.rpcClient;
        if (client) {
          await client.sessionSave();
        }
      } catch (err) {
        console.error(`[Canvas] dispose save FAILED:`, err);
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
    latestCanvasView = undefined;
  });

  return sessionReady;
}
