// The documents the stack commands' tests script: a stack as `lace stack
// list` lists it, and the list; a run as `lace run list` lists it, and the
// list; and a `Memento` that keeps what the window keeps per root.
import type * as vscode from 'vscode';
import type { Run, Stack } from '../stack-rows';

export const stack = (id: string, slug: string): Stack => ({
  id,
  orgId: 'org_1',
  teamId: 'team_1',
  connectionId: 'conn_1',
  slug,
  name: slug[0].toUpperCase() + slug.slice(1),
  description: null,
  source: { kind: 'git' as const, repoUrl: 'https://github.com/acme/repo', path: 'infra/prod' },
  stateSerial: 1,
  stateLineage: null,
  stateVersion: null,
  stateLastWrittenAt: null,
  lastAppliedRunId: null,
  lastDriftScanAt: null,
  lastDriftStatus: null,
  lastDriftCount: 0,
  lastDriftStale: false,
  lastDriftConfirmedAt: null,
  lastDriftUndeterminedReason: null,
  createdBy: { kind: 'user', id: 'usr_1', name: null },
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  archivedAt: null,
  connection: null,
  lastApply: null,
});

export const stacks = (...items: Stack[]) => ({
  items,
  nextCursor: null,
  hasMore: false,
});

// A run of `stk_1` in `status`; `more` sets what else its document says,
// such as `completedAt` once it ended and the `url` of its page.
export const run = (
  id: string,
  status: string,
  more: { completedAt?: string; url?: string } = {},
): Run => ({
  id,
  stackId: 'stk_1',
  stackName: null,
  orgId: 'org_1',
  teamId: 'team_1',
  kind: 'apply',
  status,
  initiatedVia: 'cli',
  initiatingActor: { kind: 'user', id: null, name: null },
  runner: null,
  bundleSnapshotId: null,
  sourceCommitSha: null,
  sourceRef: null,
  sourcePrUrl: null,
  sourceOverride: false,
  sourceTreeHash: null,
  planResourceAdd: 1,
  planResourceChange: 2,
  planResourceDestroy: 0,
  planLocation: null,
  applyLogLocation: null,
  gateEvaluatedWithoutBlock: null,
  gateResolution: null,
  changeRequestId: null,
  cancelReason: null,
  keepStack: false,
  version: 0,
  lastHeartbeatAt: null,
  startedAt: null,
  completedAt: more.completedAt ?? null,
  errorMessage: null,
  attestationStatus: null,
  attestedAt: null,
  attestation: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...(more.url === undefined ? {} : { url: more.url }),
});

export const runs = (...items: Run[]) => ({
  items,
  nextCursor: null,
  hasMore: false,
});

export function memento(): vscode.Memento {
  const kept = new Map<string, unknown>();
  return {
    keys: () => [...kept.keys()],
    get: ((key: string, fallback?: unknown) => (kept.has(key) ? kept.get(key) : fallback)) as never,
    update: async (key, value) => {
      kept.set(key, value);
    },
  };
}
