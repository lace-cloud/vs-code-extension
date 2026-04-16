// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useSaveState } from '../hooks/useSaveState';

describe('useSaveState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('starts in idle state', () => {
    const { result } = renderHook(() => useSaveState(vi.fn()));
    expect(result.current.status).toBe('idle');
  });

  test('idle → saving → saved → idle', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSaveState(saveFn));

    await act(async () => {
      await result.current.handleSave();
    });

    expect(saveFn).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('saved');

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.status).toBe('idle');
  });

  test('idle → saving → error → idle', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useSaveState(saveFn));

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.status).toBe('error');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.status).toBe('idle');
  });
});
