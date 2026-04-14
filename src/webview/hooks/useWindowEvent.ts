import { useEffect } from 'react';

/**
 * Attach a window event listener with automatic cleanup.
 */
export function useWindowEvent<K extends string>(
  eventName: K,
  handler: (e: Event) => void,
  deps: React.DependencyList,
) {
  useEffect(() => {
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, ...deps]);
}
