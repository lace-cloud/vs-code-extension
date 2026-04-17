import type { ReactNode } from 'react';
import './Panel.css';

export interface PanelProps {
  /** Header text or a custom node (e.g. title + badge). */
  title: ReactNode;
  /** Fires when the header's close button is clicked. */
  onClose: () => void;
  children: ReactNode;
  /** Sticky footer slot for primary actions. */
  footer?: ReactNode;
  /** Body scrolls vertically when true (default). */
  scrollable?: boolean;
  /** Fixed panel width in px. */
  width?: number;
}

export function Panel({
  title,
  onClose,
  children,
  footer,
  scrollable = true,
  width = 420,
}: PanelProps) {
  return (
    <div className="lace-panel" style={{ width }}>
      <header className="lace-panel__header">
        {typeof title === 'string' ? <h3 className="lace-panel__title">{title}</h3> : title}
        <button
          type="button"
          className="lace-panel__close"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          ×
        </button>
      </header>
      <div className={`lace-panel__body${scrollable ? ' lace-panel__body--scrollable' : ''}`}>
        {children}
      </div>
      {footer ? <footer className="lace-panel__footer">{footer}</footer> : null}
    </div>
  );
}
