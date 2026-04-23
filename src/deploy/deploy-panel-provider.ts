// Deploy panel: a WebviewView that lets the user pick a stack and
// trigger `lace run apply` for it. The panel holds the stack picker
// + the apply button + a status line for the most-recent run; the
// recent-runs TreeView lives as a sibling view in the same
// container.
//
// Architecture: the extension shells out to the CLI for every
// control-plane operation (see deploy/cli.ts). No direct HTTP to
// the API; auth stays in the CLI.

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
import type { DeployHostMessage, DeployPanelMessage, DeployStateSnapshot } from './messages';
import type { RunsTreeProvider } from './runs-tree-provider';

const POLL_INTERVAL_MS = 2000;

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
  private applyStartedAt: number | null = null;

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
    view.webview.html = buildWebviewHtml(this.context, view.webview, {
      scriptFilename: 'deploy-webview.js',
      title: 'Lace Deploy',
    });
    this.view = view;

    view.webview.onDidReceiveMessage(async (msg: DeployPanelMessage) => {
      switch (msg.command) {
        case 'ready':
          await this.refreshStacks();
          this.postSnapshot();
          break;
        case 'selectStack':
          this.setActiveStack(msg.stackId);
          break;
        case 'apply':
          this.triggerApply();
          break;
        case 'refreshStacks':
          await this.refreshStacks();
          this.postSnapshot();
          break;
        case 'openRunInPortal':
          await this.openRunInPortal(msg.runId);
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

  /**
   * Loads a run as the panel's active run (pulls its metadata, opens a
   * log stream, starts polling). Called by the Recent-runs TreeView
   * when a row is clicked so the user can attach to a historical run
   * without re-triggering an apply.
   */
  async showRun(runId: string): Promise<void> {
    try {
      const run = await getRun(runId);
      this.setActiveRun(run);
      if (this.activeStackId !== run.stackId) {
        this.setActiveStack(run.stackId);
      }
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.postSnapshot();
    }
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
    this.applyStartedAt = Date.now();
    const terminal = spawnApply(this.activeStackId, workspaceFolder.uri.fsPath);
    const disposable = vscode.window.onDidCloseTerminal((t) => {
      if (t === terminal) {
        disposable.dispose();
        void this.pickupLatestRun();
      }
    });
  }

  /**
   * After the apply terminal closes, identify the run we just kicked
   * off by correlating with the timestamp: the first run on the active
   * stack with startedAt >= applyStartedAt is ours. If no run matches
   * (apply errored before run creation), leave activeRun untouched so
   * the user sees the last known state.
   */
  private async pickupLatestRun(): Promise<void> {
    if (!this.activeStackId) return;
    await this.runsTree.refresh();
    try {
      const runs = await listRuns(this.activeStackId, 5);
      const deadline = this.applyStartedAt;
      const ours = deadline
        ? runs.find((r) => {
            const started = r.startedAt ? Date.parse(r.startedAt) : NaN;
            return !Number.isNaN(started) && started >= deadline - 2000;
          })
        : runs[0];
      if (ours) this.setActiveRun(ours);
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

  /**
   * Build the portal route for a run. Portal URL is
   * `<portalUrl>/<org>/<team>/stacks/<stackId>/runs/<runId>` for
   * general runs, and `.../change-requests/<crId>` for awaiting-
   * approval runs where the user is expected to decide. Requires
   * `lace.portalUrl`, `lace.organization`, and `lace.team` to be
   * configured (the same values the CLI uses via its env/flags).
   */
  private async openRunInPortal(runId: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('lace');
    const portalUrl = cfg.get<string>('portalUrl', '').replace(/\/$/, '');
    const org = cfg.get<string>('organization', '');
    const team = cfg.get<string>('team', '');
    if (!portalUrl) {
      vscode.window.showInformationMessage(
        'Set `lace.portalUrl` in settings to enable "Open in portal".',
      );
      return;
    }
    if (!org || !team) {
      vscode.window.showInformationMessage(
        'Set `lace.organization` and `lace.team` in settings to deep-link into the portal.',
      );
      return;
    }
    try {
      const run = await getRun(runId);
      const url = run.changeRequestId
        ? `${portalUrl}/${org}/${team}/change-requests/${run.changeRequestId}`
        : `${portalUrl}/${org}/${team}/stacks/${run.stackId}/runs/${run.id}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not resolve portal URL: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private postSnapshot(): void {
    if (!this.view) return;
    const snapshot: DeployStateSnapshot = {
      stacks: this.stacks,
      activeStackId: this.activeStackId,
      activeRun: this.activeRun,
      errorMessage: this.errorMessage,
    };
    const message: DeployHostMessage = { command: 'snapshot', state: snapshot };
    this.view.webview.postMessage(message);
  }
}
