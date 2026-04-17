import type { ContextMenuState } from '../hooks/useContextMenu';
import './ContextMenu.css';

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
    items.push({ label: 'Ungroup', action: () => onUngroup(contextMenu.groupId!) });
  } else {
    items.push(
      { label: 'Cut', shortcut: 'Ctrl+X', action: onCut },
      { label: 'Copy', shortcut: 'Ctrl+C', action: onCopy },
      { label: 'Paste', shortcut: 'Ctrl+V', action: onPaste },
    );
    if (contextMenu.selectedCount >= 2) {
      items.push({ label: 'Group', action: onGroupSelected });
    }
  }

  return (
    <>
      <div
        className="lace-ctx-menu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map(({ label, shortcut, action }) => (
          <button
            key={label}
            type="button"
            className="lace-ctx-menu__item"
            onClick={() => action()}
          >
            <span>{label}</span>
            {shortcut && <span className="lace-ctx-menu__shortcut">{shortcut}</span>}
          </button>
        ))}
      </div>
      <div className="lace-ctx-menu__scrim" onClick={onDismiss} />
    </>
  );
}
