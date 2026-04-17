// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useClipboard } from '../hooks/useClipboard';
import { makeCanvasView, makeNode } from './helpers';

function makeEngine(overrides: Record<string, unknown> = {}) {
  return {
    copyInstances: vi.fn().mockResolvedValue(makeCanvasView([makeNode('vpc'), makeNode('vpc_1')])),
    deleteInstance: vi.fn().mockResolvedValue(makeCanvasView([])),
    ...overrides,
  } as unknown as import('../engine').CanvasEngine;
}

describe('useClipboard', () => {
  const showToast = vi.fn();
  const updateView = vi.fn();
  const selectNodes = vi.fn();
  const dismissContextMenu = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('copy stores selected IDs and shows success toast', () => {
    const engine = makeEngine();
    const { result } = renderHook(() =>
      useClipboard(
        engine,
        updateView,
        makeCanvasView([makeNode('vpc')]),
        showToast,
        () => ['vpc'],
        selectNodes,
        () => null,
        dismissContextMenu,
        false,
      ),
    );

    act(() => {
      result.current.onCopy();
    });

    expect(showToast).toHaveBeenCalledWith('Copied 1 node', 'success');
  });

  test('copy with empty selection shows error toast', () => {
    const engine = makeEngine();
    const { result } = renderHook(() =>
      useClipboard(
        engine,
        updateView,
        makeCanvasView([]),
        showToast,
        () => [],
        selectNodes,
        () => null,
        dismissContextMenu,
        false,
      ),
    );

    act(() => {
      result.current.onCopy();
    });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Nothing selected'), 'error');
  });

  test('paste calls copyInstances and selects new nodes', async () => {
    const engine = makeEngine();
    const view = makeCanvasView([makeNode('vpc')]);

    const { result } = renderHook(() =>
      useClipboard(
        engine,
        updateView,
        view,
        showToast,
        () => ['vpc'],
        selectNodes,
        () => null,
        dismissContextMenu,
        false,
      ),
    );

    // Copy first
    act(() => {
      result.current.onCopy();
    });

    // Then paste
    await act(async () => {
      await result.current.onPaste();
    });

    expect(engine.copyInstances).toHaveBeenCalledWith(['vpc']);
    expect(selectNodes).toHaveBeenCalledWith(['vpc_1']);
    expect(updateView).toHaveBeenCalled();
  });

  test('cut + paste deletes originals', async () => {
    const engine = makeEngine();
    const view = makeCanvasView([makeNode('vpc')]);

    const { result } = renderHook(() =>
      useClipboard(
        engine,
        updateView,
        view,
        showToast,
        () => ['vpc'],
        selectNodes,
        () => null,
        dismissContextMenu,
        false,
      ),
    );

    // Cut first
    act(() => {
      result.current.onCut();
    });

    expect(showToast).toHaveBeenCalledWith('Cut 1 node', 'success');

    // Then paste
    await act(async () => {
      await result.current.onPaste();
    });

    expect(engine.copyInstances).toHaveBeenCalledWith(['vpc']);
    expect(engine.deleteInstance).toHaveBeenCalledWith('vpc');
  });
});
