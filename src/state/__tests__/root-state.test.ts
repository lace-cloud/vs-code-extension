import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { folder } from '../../roots/__tests__/fake-uri';
import type { AuthoringRoot } from '../../roots/authoring-roots';
import { createRootState } from '../root-state';

function memento(): vscode.Memento {
  const kept = new Map<string, unknown>();
  return {
    keys: () => [...kept.keys()],
    get: ((key: string, fallback?: unknown) => (kept.has(key) ? kept.get(key) : fallback)) as never,
    update: async (key, value) => {
      kept.set(key, value);
    },
  };
}

const repo = folder('/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'prod' };
const dev: AuthoringRoot = { folder: repo, relative: 'dev' };

describe('the picked stack', () => {
  test("is kept per root, and a root's listener hears each of its picks after it is kept", async () => {
    const state = createRootState(memento());
    const heard = vi.fn(() => state.stack(prod));
    state.onDidPickStack(prod, heard);

    expect(state.stack(prod)).toBeUndefined();
    await state.pickStack(prod, { id: 'stk_1', slug: 'prod' });
    await state.pickStack(dev, { id: 'stk_2', slug: 'dev' });

    expect(state.stack(prod)).toEqual({ id: 'stk_1', slug: 'prod' });
    expect(state.stack(dev)).toEqual({ id: 'stk_2', slug: 'dev' });
    expect(heard.mock.calls).toEqual([[{ id: 'stk_1', slug: 'prod' }]]);
    expect(heard.mock.results.map((r) => r.value)).toEqual([{ id: 'stk_1', slug: 'prod' }]);
  });

  test('survives the window: a new state over the same storage reads it', async () => {
    const storage = memento();
    await createRootState(storage).pickStack(prod, { id: 'stk_1', slug: 'prod' });
    expect(createRootState(storage).stack({ folder: folder('/repo'), relative: 'prod' })).toEqual({
      id: 'stk_1',
      slug: 'prod',
    });
  });
});

describe('the canvas arrangement', () => {
  test('is kept per root beside its picked stack, and is empty until one is kept', async () => {
    const state = createRootState(memento());
    expect(state.arrangement(prod)).toEqual({});

    await state.pickStack(prod, { id: 'stk_1', slug: 'prod' });
    await state.arrange(prod, { viewport: { x: 1, y: 2, zoom: 1 } } as never);

    expect(state.arrangement(prod)).toEqual({ viewport: { x: 1, y: 2, zoom: 1 } });
    expect(state.stack(prod)).toEqual({ id: 'stk_1', slug: 'prod' });
    expect(state.arrangement(dev)).toEqual({});
  });
});
