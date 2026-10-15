// A run a trigger starts, under a progress notification until the run ends:
// Create Stack, Import Existing Resources, and the package action a
// failure's notice offers (Import the rest). The notification is titled by
// the run (`runTitle`): its action, and what it acts on, the stack, else the
// authoring root by its name in the workspace; the run's prompts carry the
// same title.
import type { ActionContribution, ActionTarget, RunCtx } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import type { RunnerHost } from '../engine/runner-host';
import { rootLabel, rootOfPath } from '../roots/authoring-roots';

export type RunProgressApi = {
  window: Pick<typeof vscode.window, 'withProgress'>;
  workspace: Pick<typeof vscode.workspace, 'workspaceFolders'>;
  ProgressLocation: Pick<typeof vscode.ProgressLocation, 'Notification'>;
};

// The title of a run of `action` over `ctx`, among the workspace's `folders`.
export function runTitle(
  action: ActionContribution,
  ctx: RunCtx,
  folders: readonly vscode.WorkspaceFolder[],
): string {
  const root = ctx.root === undefined ? undefined : rootOfPath(folders, ctx.root);
  const subject = ctx.stack?.slug ?? (root === undefined ? ctx.root : rootLabel(root, folders));
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
  await api.window.withProgress(
    {
      location: api.ProgressLocation.Notification,
      title: runTitle(action, ctx, api.workspace.workspaceFolders ?? []),
    },
    async () => {
      const { ended } = await runner.run(action, ctx, target);
      await ended;
    },
  );
}
