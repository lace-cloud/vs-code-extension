// TreeView showing recent runs for the Deploy panel's active stack.
// Clicking a run opens its portal detail page. Refresh pulls the
// latest list from `lace run list`.

import * as vscode from 'vscode';
import { listRuns, type Run } from './cli';

const STATUS_ICON: Record<string, string> = {
  plan_succeeded: 'check',
  plan_failed: 'error',
  policy_eval: 'sync~spin',
  policy_blocked: 'error',
  auto_apply: 'sync~spin',
  awaiting_approval: 'question',
  approved: 'check',
  applying: 'sync~spin',
  apply_succeeded: 'pass-filled',
  apply_failed: 'error',
  cancelled: 'circle-slash',
  rejected: 'error',
};

export class RunTreeItem extends vscode.TreeItem {
  constructor(public readonly run: Run) {
    super(`${run.kind} · ${run.id.slice(0, 12)}`, vscode.TreeItemCollapsibleState.None);
    const plan = run.planResourceAdd ?? 0;
    const chg = run.planResourceChange ?? 0;
    const dst = run.planResourceDestroy ?? 0;
    this.description = `${run.status} · +${plan} ~${chg} -${dst}`;
    this.tooltip = [
      `Run: ${run.id}`,
      `Kind: ${run.kind}`,
      `Status: ${run.status}`,
      `Started: ${run.startedAt}`,
      run.completedAt ? `Completed: ${run.completedAt}` : null,
      run.errorMessage ? `Error: ${run.errorMessage}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    this.iconPath = new vscode.ThemeIcon(STATUS_ICON[run.status] ?? 'circle-outline');
    this.contextValue = run.status;
    this.command = {
      command: 'lace.deploy.showRun',
      title: 'Show run',
      arguments: [run.id],
    };
  }
}

export class RunsTreeProvider implements vscode.TreeDataProvider<RunTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private stackId: string | null = null;
  private runs: Run[] = [];
  private loading = false;
  private loadError: string | null = null;

  setStack(stackId: string | null): void {
    if (stackId === this.stackId) return;
    this.stackId = stackId;
    this.runs = [];
    this.loadError = null;
    this._onDidChangeTreeData.fire();
    if (stackId) void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.stackId || this.loading) return;
    this.loading = true;
    this.loadError = null;
    try {
      this.runs = await listRuns(this.stackId, 10);
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
      this.runs = [];
    } finally {
      this.loading = false;
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: RunTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<RunTreeItem[]> {
    if (!this.stackId) {
      const item = new vscode.TreeItem('No stack selected', vscode.TreeItemCollapsibleState.None);
      item.description = 'Pick a stack in the Deploy panel.';
      return [item as RunTreeItem];
    }
    if (this.loading && this.runs.length === 0) {
      const item = new vscode.TreeItem('Loading…', vscode.TreeItemCollapsibleState.None);
      return [item as RunTreeItem];
    }
    if (this.loadError) {
      const item = new vscode.TreeItem(
        `Error: ${this.loadError}`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon('error');
      return [item as RunTreeItem];
    }
    if (this.runs.length === 0) {
      const item = new vscode.TreeItem('No runs yet', vscode.TreeItemCollapsibleState.None);
      item.description = 'Use the Apply button in the Deploy panel.';
      return [item as RunTreeItem];
    }
    return this.runs.map((r) => new RunTreeItem(r));
  }
}
