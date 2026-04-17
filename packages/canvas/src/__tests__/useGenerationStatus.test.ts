// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CanvasEngine, EngineEvent, EngineEventListener } from '../engine';
import { useGenerationStatus } from '../hooks/useGenerationStatus';
import { CanvasContext, type CanvasState } from '../state/engine-context';

// Minimal engine stub: the hook only uses onEvent, so stub just that method.
// Tests fire events by invoking the captured listener directly.
function makeStubEngine(): { engine: CanvasEngine; fire: (event: EngineEvent) => void } {
  const listeners = new Set<EngineEventListener>();
  const engine = {
    onEvent(listener: EngineEventListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as CanvasEngine;
  const fire = (event: EngineEvent) => {
    for (const l of listeners) l(event);
  };
  return { engine, fire };
}

function wrapper(engine: CanvasEngine) {
  const state: CanvasState = {
    view: null,
    loading: true,
    error: null,
    generation: 0,
    viewportIntent: null,
    viewportIntentSeq: 0,
  };
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      CanvasContext.Provider,
      {
        value: {
          state,
          engine,
          updateView: () => {},
          readOnly: false,
          localGroupCollapseOverrides: {},
          toggleLocalGroupCollapse: () => {},
        },
      },
      children,
    );
}

describe('useGenerationStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('starts not generating with no errors', () => {
    const { engine } = makeStubEngine();
    const showToast = vi.fn();
    const { result } = renderHook(() => useGenerationStatus(showToast), {
      wrapper: wrapper(engine),
    });
    expect(result.current.generating).toBe(false);
    expect(result.current.validationErrors).toEqual([]);
  });

  test('generateProgress sets generating to true', () => {
    const { engine, fire } = makeStubEngine();
    const showToast = vi.fn();
    const { result } = renderHook(() => useGenerationStatus(showToast), {
      wrapper: wrapper(engine),
    });

    act(() => {
      fire({ type: 'generateProgress', phase: 'generating' });
    });

    expect(result.current.generating).toBe(true);
    expect(showToast).toHaveBeenCalledWith('Generating Terraform...', 'progress', undefined);
  });

  test('generateSuccess resets generating and clears errors', () => {
    const { engine, fire } = makeStubEngine();
    const showToast = vi.fn();
    const { result } = renderHook(() => useGenerationStatus(showToast), {
      wrapper: wrapper(engine),
    });

    act(() => {
      fire({ type: 'generateProgress', phase: 'generating' });
    });

    act(() => {
      fire({ type: 'generateSuccess' });
    });

    expect(result.current.generating).toBe(false);
    expect(result.current.validationErrors).toEqual([]);
    expect(showToast).toHaveBeenCalledWith('Successfully generated', 'success', undefined);
  });

  test('generateError populates validation errors', () => {
    const { engine, fire } = makeStubEngine();
    const showToast = vi.fn();
    const { result } = renderHook(() => useGenerationStatus(showToast), {
      wrapper: wrapper(engine),
    });

    act(() => {
      fire({
        type: 'generateError',
        message: 'bad',
        diagnostics: [{ severity: 'error', message: 'Missing required input' }],
      });
    });

    expect(result.current.generating).toBe(false);
    expect(result.current.validationErrors).toHaveLength(1);
    expect(result.current.validationErrors[0].message).toBe('Missing required input');
    expect(showToast).toHaveBeenCalledWith('Validation: 1 error(s)', 'error', undefined);
  });

  test('erroredNodeIds extracts instance_id from diagnostics', () => {
    const { engine, fire } = makeStubEngine();
    const showToast = vi.fn();
    const { result } = renderHook(() => useGenerationStatus(showToast), {
      wrapper: wrapper(engine),
    });

    act(() => {
      fire({
        type: 'generateError',
        message: 'bad',
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
