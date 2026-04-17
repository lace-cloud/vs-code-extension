import { useCallback, useState } from 'react';

export type ToastState = { message: string; type: 'progress' | 'success' | 'error' } | null;

const TOAST_BRIEF = 1500;
const TOAST_INFO = 3000;

/**
 * `duration` in ms controls auto-dismiss:
 *   - omitted → default per type (brief for success, longer for error)
 *   - finite number → explicit ms before the toast clears itself
 *   - `Infinity` → pinned; never auto-dismisses. Used by scene stories
 *     to hold a state for Chromatic snapshot.
 *   - `0` → effectively skipped; the setTimeout runs on the next tick
 *     and clears the toast before it's visible. Scene stories emit
 *     this when they want the side-effects of an event (banner state,
 *     spinner state) without the transient toast.
 *
 * `progress`-type toasts never auto-dismiss regardless of `duration`.
 */
export type ShowToastFn = (
  message: string,
  type: 'progress' | 'success' | 'error',
  duration?: number,
) => void;

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);

  const showToast: ShowToastFn = useCallback((message, type, duration) => {
    setToast({ message, type });
    if (type === 'progress') return;
    if (duration === Number.POSITIVE_INFINITY) return;
    const ms = duration ?? (type === 'error' ? TOAST_INFO : TOAST_BRIEF);
    setTimeout(() => setToast(null), ms);
  }, []);

  const clearToast = useCallback(() => setToast(null), []);

  return { toast, showToast, clearToast };
}
