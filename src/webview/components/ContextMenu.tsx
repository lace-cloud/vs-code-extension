import React from 'react';
import type { ContextMenuState } from '../hooks/useContextMenu';

type Props = {
  contextMenu: ContextMenuState;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDismiss: () => void;
};

export default function ContextMenu({ contextMenu, onCopy, onCut, onPaste, onDismiss }: Props) {
  if (!contextMenu) return null;
  return (
    <>
      <div
        className="fixed z-50 bg-[#1a1a1a] border border-[rgba(206,254,101,0.2)] rounded shadow-[0_4px_12px_rgba(0,0,0,0.5)] py-1"
        style={{ left: contextMenu.x, top: contextMenu.y, minWidth: 120 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(
          [
            { label: 'Cut', shortcut: 'Ctrl+X', action: onCut },
            { label: 'Copy', shortcut: 'Ctrl+C', action: onCopy },
            { label: 'Paste', shortcut: 'Ctrl+V', action: onPaste },
          ] as { label: string; shortcut: string; action: () => void }[]
        ).map(({ label, shortcut, action }) => (
          <button
            key={label}
            className="w-full text-left px-3 py-1.5 text-xs text-[#CEFE65] hover:bg-[#153238] cursor-pointer flex items-center justify-between gap-4"
            style={{ background: 'transparent', border: 'none' }}
            onClick={() => action()}
          >
            <span>{label}</span>
            <span className="text-[#5a7060] text-[10px]">{shortcut}</span>
          </button>
        ))}
      </div>
      {/* Dismiss on outside click */}
      <div className="fixed inset-0 z-40" onClick={onDismiss} />
    </>
  );
}
