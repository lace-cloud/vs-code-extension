import { useState, useEffect, useCallback } from 'react';
import { CANVAS_EVENTS } from '../events';

export type ContextMenuState = {
  x: number;
  y: number;
  nodeId: string | null;
} | null;

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { instanceId, x, y } = (e as CustomEvent).detail;
      setContextMenu({ x, y, nodeId: instanceId });
    };
    window.addEventListener(CANVAS_EVENTS.CONTEXT_MENU, handler);
    return () => window.removeEventListener(CANVAS_EVENTS.CONTEXT_MENU, handler);
  }, []);

  const dismissContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return { contextMenu, dismissContextMenu };
}
