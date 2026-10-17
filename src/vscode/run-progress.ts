// A run a trigger starts, under a progress notification until the run ends:
// Create Stack, Import Existing Resources, Cancel on a run row, and the
// package action a failure's notice offers (Import the rest). The
// notification is titled by the run (`runTitle`): its action, and what it
// acts on, the run its target names, else the stack, else the root the run
// names (`rootOfRun`) by its name in the workspace; the run's prompts carry
// the same title.
import type { ActionContribution, ActionTarget, RunCtx } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import type { RunnerHost } from '../engine/runner-host';
import { type AuthoringRoot, rootLabel, rootOfRun } from '../roots/authoring-roots';

export type RunProgressApi = {
  window: Pick<typeof vscode.window, 'withProgress'>;
  workspace: Pick<typeof vscode.workspace, 'workspaceFolders'>;
  ProgressLocation: Pick<typeof vscode.ProgressLocation, 'Notification'>;
};

// The title of a run of `action` over `ctx` and `target`, whose root among
// the workspace's `folders` is `root` (`rootOfRun`); a directory under no
// folder is called by its path.
export function runTitle(
  action: ActionContribution,
  ctx: RunCtx,
  target: ActionTarget,
  root: AuthoringRoot | undefined,
  folders: readonly vscode.WorkspaceFolder[],
): string {
  const subject =
    target.runId ?? ctx.stack?.slug ?? (root === undefined ? ctx.root : rootLabel(root, folders));
  return subject === undefined ? action.label : `${action.label}: ${subject}`;
}

// Runs `action` over `ctx` and `target` through `runner`, under a progress
// notification until its run ends.
export async function runUnderProgress(
  api: RunProgressApi,
  runner: Pick<RunnerHost, 'run'>,
  action: ActionContribution,
  ctx: RunCtx,
  target: ActionTarget = {},
): Promise<void> {
  const folders = api.workspace.workspaceFolders ?? [];
  await api.window.withProgress(
    {
      location: api.ProgressLocation.Notification,
      title: runTitle(action, ctx, target, rootOfRun(folders, ctx), folders),
    },
    async () => {
      const { ended } = await runner.run(action, ctx, target);
      await ended;
    },
  );
}
