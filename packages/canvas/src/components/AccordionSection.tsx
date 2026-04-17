import type React from 'react';
import { useState } from 'react';
import './AccordionSection.css';

type Props = {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
};

export default function AccordionSection({ title, defaultOpen = false, badge, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`lace-accordion${open ? ' lace-accordion--open' : ''}`}>
      <button
        type="button"
        className="lace-accordion__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg className="lace-accordion__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
        </svg>
        <span className="lace-accordion__title">{title}</span>
        {badge && <span className="lace-accordion__badge">{badge}</span>}
      </button>

      <div className="lace-accordion__body">
        <div className="lace-accordion__body-inner">
          <div className="lace-accordion__body-content">{children}</div>
        </div>
      </div>
    </div>
  );
}
