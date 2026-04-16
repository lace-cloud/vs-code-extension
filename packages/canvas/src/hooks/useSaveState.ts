import { useCallback, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Shared save state machine for settings panels.
 *
 * Handles: idle → saving → saved (1.5s) → idle
 *                        → error (2s) → idle
 */
export function useSaveState(saveFn: () => Promise<void>) {
  const [status, setStatus] = useState<SaveStatus>('idle');

  const handleSave = useCallback(async () => {
    setStatus('saving');
    try {
      await saveFn();
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1500);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  }, [saveFn]);

  return { status, handleSave };
}
