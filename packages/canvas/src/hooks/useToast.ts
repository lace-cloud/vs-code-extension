import { useCallback, useState } from 'react';

export type ToastState = { message: string; type: 'progress' | 'success' | 'error' } | null;

const TOAST_BRIEF = 1500;
const TOAST_INFO = 3000;

export type ShowToastFn = (
  message: string,
  type: 'progress' | 'success' | 'error',
  duration?: number,
) => void;

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);

  const showToast: ShowToastFn = useCallback((message, type, duration) => {
    setToast({ message, type });
    if (type !== 'progress') {
      const ms = duration ?? (type === 'error' ? TOAST_INFO : TOAST_BRIEF);
      setTimeout(() => setToast(null), ms);
    }
  }, []);

  const clearToast = useCallback(() => setToast(null), []);

  return { toast, showToast, clearToast };
}
