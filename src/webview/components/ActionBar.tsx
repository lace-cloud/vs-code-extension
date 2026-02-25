import React from 'react';
import { Panel } from '@xyflow/react';

// ── Types ──

type ActionBarProps = {
  onSave: () => void;
  onRefresh: () => void;
  onUndo: () => void;
  onClearGraph: () => void;
  onGenerate: () => void;
  onOpenSettings: () => void;
};

// ── Component ──

export default function ActionBar({
  onSave,
  onRefresh,
  onUndo,
  onClearGraph,
  onGenerate,
  onOpenSettings,
}: ActionBarProps) {
  return (
    <Panel position="top-right">
      <div className="flex items-center gap-0 bg-[#1e1e1e]/80 backdrop-blur border border-[#333] rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
        {/* Left group: utility actions */}
        <button
          onClick={onSave}
          title="Save (Cmd+S)"
          aria-label="Save"
          className="w-8 h-8 flex items-center justify-center bg-transparent border-none text-[#999] hover:text-white cursor-pointer rounded-l-lg"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4zm-5 16a3 3 0 110-6 3 3 0 010 6zm3-10H5V5h10v4z" />
          </svg>
        </button>

        <button
          onClick={onRefresh}
          title="Refresh modules from registry"
          aria-label="Refresh modules"
          className="w-8 h-8 flex items-center justify-center bg-transparent border-none text-[#999] hover:text-white cursor-pointer"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
        </button>

        <button
          onClick={onClearGraph}
          title="Clear all modules"
          aria-label="Clear all"
          className="w-8 h-8 flex items-center justify-center bg-transparent border-none text-[#999] hover:text-white cursor-pointer"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
          </svg>
        </button>

        <button
          onClick={onUndo}
          title="Undo (Cmd+Z)"
          aria-label="Undo"
          className="w-8 h-8 flex items-center justify-center bg-transparent border-none text-[#999] hover:text-white cursor-pointer"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
          </svg>
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-[#444] mx-0.5" />

        {/* Right group: project actions */}
        <button
          onClick={onGenerate}
          title="Generate Terraform files"
          aria-label="Generate"
          className="w-8 h-8 flex items-center justify-center bg-[#2ea043] border-none text-white cursor-pointer hover:bg-[#3ab550]"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29a.996.996 0 00-1.41 0L1.29 18.96a.996.996 0 000 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05a.996.996 0 000-1.41l-2.33-2.35zm-1.97 5.67L7.73 8.29l2.07-2.07 4.67 4.67-2.07 2.07z" />
          </svg>
        </button>

        {/* Gear button — opens unified settings panel */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className="w-8 h-8 flex items-center justify-center bg-transparent border-none text-[#999] hover:text-white cursor-pointer rounded-r-lg"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z" />
          </svg>
        </button>
      </div>
    </Panel>
  );
}
