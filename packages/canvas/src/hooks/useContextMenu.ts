import { useCallback, useEffect, useState } from 'react';
import { CANVAS_EVENTS } from '../events';

export type ContextMenuState = {
  x: number;
  y: number;
  nodeId: string | null;
  groupId: string | null;
  selectedCount: number;
} | null;

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { instanceId, groupId, selectedCount, x, y } = (e as CustomEvent).detail;
      setContextMenu({
        x,
        y,
        nodeId: instanceId ?? null,
        groupId: groupId ?? null,
        selectedCount: selectedCount ?? 0,
      });
    };
    window.addEventListener(CANVAS_EVENTS.CONTEXT_MENU, handler);
    return () => window.removeEventListener(CANVAS_EVENTS.CONTEXT_MENU, handler);
  }, []);

  const dismissContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return { contextMenu, dismissContextMenu };
}
