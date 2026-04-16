// src/webview/components/PanelFrame.tsx
import React from 'react';

type Props = {
  title: string | React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
  scrollable?: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export default function PanelFrame({
  title,
  width = 420,
  footer,
  scrollable = true,
  onClose,
  children,
}: Props) {
  return (
    <div
      className={`w-[${width}px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col`}
      style={{ width }}
    >
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        {typeof title === 'string' ? <h3 className="m-0 text-base">{title}</h3> : title}
        <button
          onClick={onClose}
          className="cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-lg w-[34px] h-[34px]"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className={scrollable ? 'flex-1 overflow-y-auto p-4 pb-24' : 'flex-1 overflow-y-auto'}>
        {children}
      </div>

      {footer && (
        <footer className="p-4 border-t border-[#333] bg-[#1e1e1e] sticky bottom-0 z-30">
          {footer}
        </footer>
      )}
    </div>
  );
}
