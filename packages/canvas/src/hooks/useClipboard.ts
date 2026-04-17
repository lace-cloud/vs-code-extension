import { useCallback, useEffect, useRef } from 'react';
import type { CanvasEngine } from '../engine';
import type { CanvasView } from '../types/render';
import type { ShowToastFn } from './useToast';

export function useClipboard(
  engine: CanvasEngine | null,
  updateView: (view: CanvasView) => void,
  view: CanvasView | null,
  showToast: ShowToastFn,
  getSelectedIds: () => string[],
  selectNodes: (ids: string[]) => void,
  getContextMenuNodeId: () => string | null,
  dismissContextMenu: () => void,
  readOnly: boolean,
) {
  const clipboardRef = useRef<string[]>([]);
  const isCutRef = useRef(false);

  const onCopy = useCallback(() => {
    const selected = getSelectedIds();
    const ctx = getContextMenuNodeId();
    const ids = ctx && !selected.includes(ctx) ? [...selected, ctx] : selected;
    if (ids.length === 0) {
      showToast('Nothing selected \u2014 click a node first', 'error');
      return;
    }
    clipboardRef.current = ids;
    isCutRef.current = false;
    dismissContextMenu();
    const count = selected.length > 0 ? selected.length : ids.length;
    showToast(`Copied ${count} node${count > 1 ? 's' : ''}`, 'success');
  }, [getSelectedIds, getContextMenuNodeId, dismissContextMenu, showToast]);

  const onCut = useCallback(() => {
    const selected = getSelectedIds();
    const ctx = getContextMenuNodeId();
    const ids = ctx && !selected.includes(ctx) ? [...selected, ctx] : selected;
    if (ids.length === 0) {
      showToast('Nothing selected \u2014 click a node first', 'error');
      return;
    }
    clipboardRef.current = ids;
    isCutRef.current = true;
    dismissContextMenu();
    const count = selected.length > 0 ? selected.length : ids.length;
    showToast(`Cut ${count} node${count > 1 ? 's' : ''}`, 'success');
  }, [getSelectedIds, getContextMenuNodeId, dismissContextMenu, showToast]);

  const onPaste = useCallback(async () => {
    dismissContextMenu();
    if (!engine || clipboardRef.current.length === 0) {
      showToast('Clipboard empty \u2014 copy a node first', 'error');
      return;
    }
    const ids = clipboardRef.current;
    try {
      const prevIds = new Set((view?.nodes ?? []).map((n) => n.id));
      const result = await engine.copyInstances(ids);
      const newIds = result.nodes
        .filter((n: { id: string }) => !prevIds.has(n.id) && !ids.includes(n.id))
        .map((n: { id: string }) => n.id);
      if (newIds.length > 0) {
        selectNodes(newIds);
      }
      updateView(result);
      if (isCutRef.current) {
        for (const id of ids) {
          const r = await engine.deleteInstance(id);
          updateView(r);
        }
        clipboardRef.current = [];
        isCutRef.current = false;
      }
    } catch (err) {
      console.error('[Canvas] paste failed:', err);
      showToast('Paste failed \u2014 try again', 'error');
    }
  }, [engine, updateView, view, showToast, selectNodes, dismissContextMenu]);

  // Expose globally for HTML-level keyboard shortcuts. In read-only we
  // skip the install so Cmd+C/X/V route through their host-side
  // handlers, find `window.__canvas*` undefined, and no-op.
  useEffect(() => {
    if (readOnly) return;
    window.__canvasCopy = onCopy;
    window.__canvasCut = onCut;
    window.__canvasPaste = onPaste;
    return () => {
      window.__canvasCopy = undefined;
      window.__canvasCut = undefined;
      window.__canvasPaste = undefined;
    };
  }, [onCopy, onCut, onPaste, readOnly]);

  return { onCopy, onCut, onPaste };
}
