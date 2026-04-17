import { useEffect } from 'react';

/**
 * Attach a window event listener with automatic cleanup.
 *
 * Pass `{ enabled: false }` to opt out of installing the listener —
 * e.g. to leave a mutation-triggering event unhandled in read-only
 * mode. An uninstalled listener is silent by construction; the
 * alternative (install + guard inside the handler) leaves the
 * attach/detach side-effect running for no reason.
 */
export function useWindowEvent<K extends string>(
  eventName: K,
  handler: (e: Event) => void,
  deps: React.DependencyList,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }, [eventName, enabled, ...deps]);
}
