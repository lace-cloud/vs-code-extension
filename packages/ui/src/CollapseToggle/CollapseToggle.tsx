import './CollapseToggle.css';

export interface CollapseToggleProps {
  open: boolean;
  onClick: () => void;
  /** Accessible label; falls back to "Expand" / "Collapse". */
  label?: string;
}

export function CollapseToggle({ open, onClick, label }: CollapseToggleProps) {
  const resolvedLabel = label ?? (open ? 'Collapse' : 'Expand');
  return (
    <button
      type="button"
      className={`lace-collapse-toggle${open ? ' lace-collapse-toggle--open' : ''}`}
      onClick={onClick}
      aria-expanded={open}
      aria-label={resolvedLabel}
      title={resolvedLabel}
    >
      <svg className="lace-collapse-toggle__chevron" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
      </svg>
    </button>
  );
}
