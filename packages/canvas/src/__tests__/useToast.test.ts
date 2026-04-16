// @vitest-environment jsdom
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from '../hooks/useToast';

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('starts with no toast', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  test('success toast auto-dismisses after 1500ms', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('Saved', 'success');
    });

    expect(result.current.toast).toEqual({ message: 'Saved', type: 'success' });

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.toast).toBeNull();
  });

  test('error toast auto-dismisses after 3000ms', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('Failed', 'error');
    });

    expect(result.current.toast).toEqual({ message: 'Failed', type: 'error' });

    act(() => {
      vi.advanceTimersByTime(2999);
    });

    expect(result.current.toast).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.toast).toBeNull();
  });

  test('progress toast does not auto-dismiss', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('Working...', 'progress');
    });

    expect(result.current.toast).toEqual({ message: 'Working...', type: 'progress' });

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(result.current.toast).not.toBeNull();
  });

  test('clearToast dismisses immediately', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('Working...', 'progress');
    });

    expect(result.current.toast).not.toBeNull();

    act(() => {
      result.current.clearToast();
    });

    expect(result.current.toast).toBeNull();
  });
});
