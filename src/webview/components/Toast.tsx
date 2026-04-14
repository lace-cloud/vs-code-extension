import React from 'react';
import type { ToastState } from '../hooks/useToast';

type Props = {
  toast: ToastState;
};

export default function Toast({ toast }: Props) {
  if (!toast) return null;
  return (
    <div
      className={`absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-md text-xs shadow-[0_2px_6px_rgba(0,0,0,0.3)] border ${
        toast.type === 'error'
          ? 'bg-[#3a1518] text-[#f87171] border-[rgba(248,113,113,0.3)]'
          : 'bg-[#153238] text-[#CEFE65] border-[rgba(206,254,101,0.2)]'
      }`}
    >
      {toast.type === 'progress' && (
        <div className="w-3.5 h-3.5 border-2 border-[#CEFE65] border-t-transparent rounded-full animate-spin" />
      )}
      {toast.message}
    </div>
  );
}
