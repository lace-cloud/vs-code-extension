// Deploy panel: a WebviewView that lets the user pick a stack and
// trigger `lace run apply` for it. The panel holds the stack picker
// + the apply button + a status line for the most-recent run; the
// recent-runs TreeView lives as a sibling view in the same
// container.
//
// Architecture note: the extension shells out to the CLI for every
// control-plane operation (see deploy/cli.ts for the rationale).
// No direct HTTP to the API; auth stays in the CLI.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildWebviewHtml } from '../vscode/webview-html';
import {
  getRun,
  isTerminal,
  listRuns,
  listStacks,
  type Run,
  type Stack,
  spawnApply,
  streamRunLogs,
} from './cli';
import type { RunsTreeProvider } from './runs-tree-provider';

const POLL_INTERVAL_MS = 2000;

type StateSnapshot = {
  stacks: Stack[];
  activeStackId: string | null;
  activeRun: Run | null;
  errorMessage: string | null;
};

export class DeployPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'laceDeploy';

  private view: vscode.WebviewView | null = null;
  private stacks: Stack[] = [];
  private activeStackId: string | null = null;
  private activeRun: Run | null = null;
  private errorMessage: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private logChannels = new Map<string, vscode.OutputChannel>();
  private logStreams = new Map<string, { dispose: () => void }>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly runsTree: RunsTreeProvider,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'out')),
        vscode.Uri.joinPath(this.context.extensionUri, 'images'),
      ],
    };
    view.webview.html = this.buildHtml(view.webview);
    this.view = view;

    view.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'ready':
          await this.refreshStacks();
          this.postSnapshot();
          break;
        case 'selectStack':
          this.setActiveStack((msg.stackId as string) || null);
          break;
        case 'apply':
          this.triggerApply();
          break;
        case 'refreshStacks':
          await this.refreshStacks();
          this.postSnapshot();
          break;
        case 'openRunInPortal':
          this.openRunInPortal(msg.runId as string);
          break;
      }
    });

    view.onDidDispose(() => {
      this.view = null;
      this.stopPolling();
      for (const stream of this.logStreams.values()) stream.dispose();
      this.logStreams.clear();
    });
  }

  showRun(runId: string): void {
    this.openRunInPortal(runId);
  }

  private buildHtml(webview: vscode.Webview): string {
    // Inline a minimal React-free webview — the deploy panel is form-shaped,
    // no canvas, no shared UI components. Keeping it script-minimal avoids
    // pulling the rspack chain through another bundle.
    const nonce = Math.random().toString(36).slice(2);
    const script = `
      const vscode = acquireVsCodeApi();
      const $ = (id) => document.getElementById(id);

      vscode.postMessage({ command: 'ready' });

      window.addEventListener('message', (ev) => {
        const msg = ev.data;
        if (msg?.command === 'snapshot') renderSnapshot(msg.state);
      });

      function renderSnapshot(state) {
        const picker = $('stack-picker');
        picker.innerHTML = '';
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '— select a stack —';
        picker.appendChild(empty);
        for (const s of state.stacks) {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.slug + ' — ' + s.name;
          if (s.id === state.activeStackId) opt.selected = true;
          picker.appendChild(opt);
        }
        $('apply-btn').disabled = !state.activeStackId;
        const err = $('error');
        err.style.display = state.errorMessage ? 'block' : 'none';
        err.textContent = state.errorMessage || '';

        const run = $('active-run');
        if (state.activeRun) {
          const r = state.activeRun;
          run.style.display = 'block';
          $('run-id').textContent = r.id;
          $('run-status').textContent = r.status;
          $('run-kind').textContent = r.kind;
          const counts = 'adds ' + (r.planResourceAdd || 0) +
                         ', changes ' + (r.planResourceChange || 0) +
                         ', destroys ' + (r.planResourceDestroy || 0);
          $('run-counts').textContent = counts;
          $('portal-btn').style.display = r.status === 'awaiting_approval' ? 'inline-block' : 'none';
        } else {
          run.style.display = 'none';
        }
      }

      $('stack-picker').addEventListener('change', (ev) => {
        vscode.postMessage({ command: 'selectStack', stackId: ev.target.value });
      });
      $('apply-btn').addEventListener('click', () => {
        vscode.postMessage({ command: 'apply' });
      });
      $('refresh-btn').addEventListener('click', () => {
        vscode.postMessage({ command: 'refreshStacks' });
      });
      $('portal-btn').addEventListener('click', () => {
        const id = $('run-id').textContent;
        if (id) vscode.postMessage({ command: 'openRunInPortal', runId: id });
      });
    `.trim();

    const body = `
      <style>
        body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
        label { display: block; margin-top: 10px; font-size: 12px; color: var(--vscode-descriptionForeground); }
        select, button { width: 100%; padding: 6px 10px; margin-top: 4px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-contrastBorder, transparent); border-radius: 3px; }
        button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .row { margin-top: 14px; }
        .error { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); padding: 6px 8px; margin-top: 10px; font-size: 12px; display: none; }
        .run { background: var(--vscode-textBlockQuote-background); border: 1px solid var(--vscode-panel-border); padding: 10px; margin-top: 14px; display: none; border-radius: 3px; font-size: 12px; }
        .run strong { display: block; font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
        .run code { font-family: var(--vscode-editor-font-family); font-size: 11px; }
        .portal-btn { margin-top: 8px; display: none; }
      </style>
      <div>
        <label for="stack-picker">Stack</label>
        <select id="stack-picker"></select>
        <div class="row">
          <button id="apply-btn" class="primary" disabled>Apply</button>
        </div>
        <div class="row">
          <button id="refresh-btn">Refresh stacks</button>
        </div>
        <div class="error" id="error"></div>
        <div class="run" id="active-run">
          <strong>Current run</strong>
          <div><code id="run-id"></code></div>
          <div>Kind: <code id="run-kind"></code></div>
          <div>Status: <code id="run-status"></code></div>
          <div><code id="run-counts"></code></div>
          <button id="portal-btn" class="portal-btn">Open in portal</button>
        </div>
      </div>
    `.trim();

    // Reuse the extension's shared HTML scaffold for CSP + nonce, but
    // inline the body + script via a data: URL since buildWebviewHtml
    // expects a file-backed script. Simpler path: hand-roll the HTML.
    void buildWebviewHtml;
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html><html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Lace Deploy</title>
</head><body>
  ${body}
  <script nonce="${nonce}">${script}</script>
</body></html>`;
  }

  private async refreshStacks(): Promise<void> {
    try {
      this.stacks = await listStacks();
      this.errorMessage = null;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.stacks = [];
    }
  }

  private setActiveStack(stackId: string | null): void {
    if (stackId === this.activeStackId) return;
    this.activeStackId = stackId;
    this.activeRun = null;
    this.stopPolling();
    this.runsTree.setStack(stackId);
    this.postSnapshot();
  }

  private triggerApply(): void {
    if (!this.activeStackId) return;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('Open a workspace folder first.');
      return;
    }
    const terminal = spawnApply(this.activeStackId, workspaceFolder.uri.fsPath);
    // The terminal exits when `lace run apply` finishes; we refresh the
    // runs list on close to pull in the new run row.
    const disposable = vscode.window.onDidCloseTerminal((t) => {
      if (t === terminal) {
        disposable.dispose();
        void this.pickupLatestRun();
      }
    });
  }

  private async pickupLatestRun(): Promise<void> {
    if (!this.activeStackId) return;
    await this.runsTree.refresh();
    try {
      const runs = await listRuns(this.activeStackId, 1);
      const latest = runs[0] ?? null;
      if (latest) this.setActiveRun(latest);
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.postSnapshot();
    }
  }

  private setActiveRun(run: Run): void {
    this.activeRun = run;
    this.startLogStream(run.id);
    this.postSnapshot();
    if (!isTerminal(run.status)) {
      this.startPolling();
    } else {
      this.stopPolling();
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      if (!this.activeRun) {
        this.stopPolling();
        return;
      }
      try {
        const run = await getRun(this.activeRun.id);
        this.activeRun = run;
        this.postSnapshot();
        if (isTerminal(run.status)) this.stopPolling();
      } catch (err) {
        this.errorMessage = err instanceof Error ? err.message : String(err);
        this.postSnapshot();
      }
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startLogStream(runId: string): void {
    if (this.logStreams.has(runId)) return;
    let channel = this.logChannels.get(runId);
    if (!channel) {
      channel = vscode.window.createOutputChannel(`Lace: run ${runId.slice(0, 12)}`);
      this.logChannels.set(runId, channel);
    }
    channel.show(true);
    const stream = streamRunLogs(runId, channel);
    this.logStreams.set(runId, stream);
  }

  private openRunInPortal(runId: string): void {
    const configured = vscode.workspace.getConfiguration('lace').get<string>('portalUrl', '');
    if (!configured) {
      vscode.window.showInformationMessage(
        'Set `lace.portalUrl` to your Lace portal URL to enable "Open in portal".',
      );
      return;
    }
    // The portal route is /{org}/{team}/stacks/{stackId}/runs/{runId}.
    // We don't know org/team from the run alone; point at the top-level
    // runs search and let the user navigate. Refinement: resolve
    // org/team from `lace stack get <stackId>` when we need direct
    // deep-linking.
    const base = configured.replace(/\/$/, '');
    void vscode.env.openExternal(vscode.Uri.parse(`${base}/runs/${runId}`));
  }

  private postSnapshot(): void {
    if (!this.view) return;
    const snapshot: StateSnapshot = {
      stacks: this.stacks,
      activeStackId: this.activeStackId,
      activeRun: this.activeRun,
      errorMessage: this.errorMessage,
    };
    this.view.webview.postMessage({ command: 'snapshot', state: snapshot });
  }
}
