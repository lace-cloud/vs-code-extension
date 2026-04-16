// src/webview/styles/panel.ts
// Shared CSS class constants for panel components.

export const inputClasses =
  'w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs';

export const modeButtonBase =
  'text-[10px] px-2 py-1 rounded cursor-pointer border transition-colors duration-100';

export const modeButtonActive = 'bg-[#1f6feb] border-[#1f6feb] text-white font-bold';

export const modeButtonInactive =
  'bg-transparent border-[#555] text-[#999] hover:text-white hover:border-[#888]';

export const rowCardClasses = 'mb-4 p-3 bg-[#0f0f0f] border border-[#333] rounded-lg';

// NOTE: The old `saveButtonClasses` / `saveButtonSavingClasses` /
// `saveButtonSuccessClasses` / `saveButtonErrorClasses` exports were
// removed — `SaveButton` now consumes the `Button` primitive from
// `@lace/ui`. When we refactor `ModuleConfigPanel`'s footer in a later
// session, `footerSaveButtonClasses` goes too.

export const footerSaveButtonClasses =
  'w-full py-3 bg-[#1f6feb] text-white border-none rounded-[10px] font-bold text-sm cursor-pointer';

export const removeButtonClasses =
  'text-[#e5484d] text-xs px-2 cursor-pointer bg-transparent border-none';

export const removeButtonSmClasses =
  'text-[#e5484d] text-[10px] px-1.5 cursor-pointer bg-transparent border-none';

export const addButtonClasses =
  'text-xs text-[#1f6feb] cursor-pointer bg-transparent border-none mb-4';

export const addButtonSmClasses =
  'text-[10px] text-[#1f6feb] cursor-pointer bg-transparent border-none mt-1';
