// The documents the stack commands' tests script: a stack as `lace stack
// list` lists it, and the list; and a `Memento` that keeps what the window
// keeps per root.
import type * as vscode from 'vscode';

export const stack = (id: string, slug: string) => ({
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
  chaosLockedByRunId: null,
  chaosLockedAt: null,
  createdBy: 'usr_1',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  archivedAt: null,
  connection: null,
  createdByName: null,
  lastApply: null,
});

export const stacks = (...items: ReturnType<typeof stack>[]) => ({
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
