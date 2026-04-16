import type { ContextMenuState } from '../hooks/useContextMenu';

type Props = {
  contextMenu: ContextMenuState;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onGroupSelected: () => void;
  onUngroup: (groupId: string) => void;
  onDismiss: () => void;
};

export default function ContextMenu({
  contextMenu,
  onCopy,
  onCut,
  onPaste,
  onGroupSelected,
  onUngroup,
  onDismiss,
}: Props) {
  if (!contextMenu) return null;

  const items: { label: string; shortcut?: string; action: () => void }[] = [];

  if (contextMenu.groupId) {
    // Right-clicked on a group node
    items.push({ label: 'Ungroup', action: () => onUngroup(contextMenu.groupId!) });
  } else {
    // Standard items
    items.push(
      { label: 'Cut', shortcut: 'Ctrl+X', action: onCut },
      { label: 'Copy', shortcut: 'Ctrl+C', action: onCopy },
      { label: 'Paste', shortcut: 'Ctrl+V', action: onPaste },
    );
    if (contextMenu.selectedCount >= 2) {
      items.push({ label: 'Group Selected', action: onGroupSelected });
    }
  }

  return (
    <>
      <div
        className="fixed z-50 bg-[#1a1a1a] border border-[rgba(206,254,101,0.2)] rounded shadow-[0_4px_12px_rgba(0,0,0,0.5)] py-1"
        style={{ left: contextMenu.x, top: contextMenu.y, minWidth: 120 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map(({ label, shortcut, action }) => (
          <button
            key={label}
            className="w-full text-left px-3 py-1.5 text-xs text-[#CEFE65] hover:bg-[#153238] cursor-pointer flex items-center justify-between gap-4"
            style={{ background: 'transparent', border: 'none' }}
            onClick={() => action()}
          >
            <span>{label}</span>
            {shortcut && <span className="text-[#5a7060] text-[10px]">{shortcut}</span>}
          </button>
        ))}
      </div>
      {/* Dismiss on outside click */}
      <div className="fixed inset-0 z-40" onClick={onDismiss} />
    </>
  );
}
