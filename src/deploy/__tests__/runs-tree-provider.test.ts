import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createVscodeMock } from '../../../packages/chat-sidebar/src/__tests__/test-utils/vscode-mock';

vi.mock('vscode', () => createVscodeMock());
vi.mock('../cli', () => ({
  listRuns: vi.fn(),
}));

import { listRuns } from '../cli';
import { RunsTreeProvider } from '../runs-tree-provider';

describe('RunsTreeProvider', () => {
  beforeEach(() => {
    vi.mocked(listRuns).mockReset();
  });

  test('initial state shows "No stack selected"', async () => {
    const provider = new RunsTreeProvider();
    const children = await provider.getChildren();
    expect(children).toHaveLength(1);
    expect((children as Array<{ label: string }>)[0]!.label).toBe('No stack selected');
    expect(listRuns).not.toHaveBeenCalled();
  });

  test('setStack triggers a refresh and populates runs', async () => {
    vi.mocked(listRuns).mockResolvedValue([
      {
        id: 'run_1',
        stackId: 'stk_x',
        kind: 'apply',
        status: 'apply_succeeded',
        bundleSnapshotId: 'bs_abc',
        initiatedByUserId: 'u1',
        initiatedVia: 'cli',
        planResourceAdd: 2,
        planResourceChange: 1,
        planResourceDestroy: 0,
        startedAt: '2026-04-22T00:00:00Z',
      },
    ]);
    const provider = new RunsTreeProvider();
    // setStack kicks an async refresh — await the listRuns mock resolution.
    provider.setStack('stk_x');
    await vi.waitFor(() => expect(listRuns).toHaveBeenCalledWith('stk_x', 10));

    const children = (await provider.getChildren()) as Array<{
      label: string;
      description?: string;
    }>;
    expect(children).toHaveLength(1);
    expect(children[0]!.label).toContain('apply · run_1');
    expect(children[0]!.description).toContain('apply_succeeded');
  });

  test('setStack(null) clears runs and shows no-stack placeholder', async () => {
    vi.mocked(listRuns).mockResolvedValue([]);
    const provider = new RunsTreeProvider();
    provider.setStack('stk_x');
    await vi.waitFor(() => expect(listRuns).toHaveBeenCalled());
    provider.setStack(null);
    const children = (await provider.getChildren()) as Array<{ label: string }>;
    expect(children[0]!.label).toBe('No stack selected');
  });

  test('shows error placeholder when listRuns throws', async () => {
    vi.mocked(listRuns).mockRejectedValue(new Error('engine unreachable'));
    const provider = new RunsTreeProvider();
    provider.setStack('stk_y');
    await vi.waitFor(() => expect(listRuns).toHaveBeenCalled());
    const children = (await provider.getChildren()) as Array<{ label: string }>;
    expect(children[0]!.label).toContain('engine unreachable');
  });

  test('shows no-runs placeholder when the list is empty', async () => {
    vi.mocked(listRuns).mockResolvedValue([]);
    const provider = new RunsTreeProvider();
    provider.setStack('stk_z');
    await vi.waitFor(() => expect(listRuns).toHaveBeenCalled());
    const children = (await provider.getChildren()) as Array<{ label: string }>;
    expect(children[0]!.label).toBe('No runs yet');
  });

  test('refresh() re-fetches without changing the selected stack', async () => {
    vi.mocked(listRuns).mockResolvedValue([]);
    const provider = new RunsTreeProvider();
    provider.setStack('stk_z');
    await vi.waitFor(() => expect(listRuns).toHaveBeenCalledTimes(1));
    await provider.refresh();
    expect(listRuns).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = vi.mocked(listRuns).mock.calls;
    expect(firstCall![0]).toBe(secondCall![0]);
  });
});
