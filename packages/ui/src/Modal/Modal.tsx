import { type ReactNode, useEffect } from 'react';
import './Modal.css';

export type ModalTone = 'default' | 'danger';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Applies a red-accented border + title for error/confirm-destructive dialogs. */
  tone?: ModalTone;
  /** Fixed modal width in px. Defaults to 520. */
  width?: number;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  tone = 'default',
  width = 520,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="lace-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`lace-modal lace-modal--tone-${tone}`}
        role="dialog"
        aria-modal="true"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="lace-modal__header">
          {typeof title === 'string' ? <h2 className="lace-modal__title">{title}</h2> : title}
          <button
            type="button"
            className="lace-modal__close"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        </header>
        <div className="lace-modal__body">{children}</div>
        {footer ? <footer className="lace-modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
