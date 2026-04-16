// @vitest-environment jsdom
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGenerationStatus } from '../hooks/useGenerationStatus';
import { CANVAS_EVENTS } from '../events';

function fireHostMessage(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.HOST_MESSAGE, { detail }));
}

describe('useGenerationStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('starts not generating with no errors', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useGenerationStatus(showToast));
    expect(result.current.generating).toBe(false);
    expect(result.current.validationErrors).toEqual([]);
  });

  test('generateProgress sets generating to true', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useGenerationStatus(showToast));

    act(() => {
      fireHostMessage({ command: 'generateProgress', phase: 'generating' });
    });

    expect(result.current.generating).toBe(true);
    expect(showToast).toHaveBeenCalledWith('Generating Terraform...', 'progress');
  });

  test('generateSuccess resets generating and clears errors', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useGenerationStatus(showToast));

    act(() => {
      fireHostMessage({ command: 'generateProgress', phase: 'generating' });
    });

    act(() => {
      fireHostMessage({ command: 'generateSuccess' });
    });

    expect(result.current.generating).toBe(false);
    expect(result.current.validationErrors).toEqual([]);
    expect(showToast).toHaveBeenCalledWith('Successfully generated', 'success');
  });

  test('generateError populates validation errors', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useGenerationStatus(showToast));

    const diagnostics = [{ severity: 'error', message: 'Missing required input' }];

    act(() => {
      fireHostMessage({ command: 'generateError', diagnostics });
    });

    expect(result.current.generating).toBe(false);
    expect(result.current.validationErrors).toHaveLength(1);
    expect(result.current.validationErrors[0].message).toBe('Missing required input');
    expect(showToast).toHaveBeenCalledWith('Validation: 1 error(s)', 'error');
  });

  test('erroredNodeIds extracts instance_id from diagnostics', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useGenerationStatus(showToast));

    act(() => {
      fireHostMessage({
        command: 'generateError',
        diagnostics: [
          { severity: 'error', message: 'bad', instance_id: 'vpc' },
          { severity: 'error', message: 'bad', instance_id: 'subnet' },
        ],
      });
    });

    expect(result.current.erroredNodeIds.has('vpc')).toBe(true);
    expect(result.current.erroredNodeIds.has('subnet')).toBe(true);
    expect(result.current.erroredNodeIds.size).toBe(2);
  });
});
