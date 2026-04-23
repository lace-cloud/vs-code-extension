// Shared message types for the deploy panel: the webview bootstrap
// (src/deploy-webview-entry.ts) and the host provider
// (src/deploy/deploy-panel-provider.ts) both import from here so the
// postMessage contract is compiler-checked on both ends.

import type { Run, Stack } from './cli';

export type DeployStateSnapshot = {
  stacks: Stack[];
  activeStackId: string | null;
  activeRun: Run | null;
  errorMessage: string | null;
};

/** Messages the webview sends to the host. */
export type DeployPanelMessage =
  | { command: 'ready' }
  | { command: 'selectStack'; stackId: string | null }
  | { command: 'apply' }
  | { command: 'refreshStacks' }
  | { command: 'openRunInPortal'; runId: string };

/** Messages the host sends to the webview. */
export type DeployHostMessage = { command: 'snapshot'; state: DeployStateSnapshot };
