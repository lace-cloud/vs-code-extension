import React, { useState } from 'react';

type Props = {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
};

export default function AccordionSection({ title, defaultOpen = false, badge, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[#333]">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-transparent border-none text-left cursor-pointer text-[#ccc] hover:text-white transition-colors duration-100"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          width="12"
          height="12"
          className="shrink-0 transition-transform duration-200"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
        </svg>
        <span className="text-[13px] font-bold uppercase tracking-wide opacity-85 flex-1">
          {title}
        </span>
        {badge && <span className="text-[11px] opacity-60 font-normal">{badge}</span>}
      </button>

      {/* Body — animated height via grid trick */}
      <div
        className="transition-[grid-template-rows] duration-200 ease-out"
        style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
