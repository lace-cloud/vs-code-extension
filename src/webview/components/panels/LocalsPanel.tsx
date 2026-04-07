// src/webview/components/panels/LocalsPanel.tsx
import React, { useState, useCallback } from 'react';
import type { SettingsConfig } from '../../types/render';
import { isValidTerraformIdentifier } from '../../utils/identifiers';
import {
  inputClasses,
  modeButtonBase,
  modeButtonActive,
  modeButtonInactive,
  saveButtonClasses,
  saveButtonSavingClasses,
  saveButtonSuccessClasses,
  saveButtonErrorClasses,
  removeButtonClasses,
  addButtonClasses,
  rowCardClasses,
} from '../../styles/panel';
import PanelFrame from '../PanelFrame';

// ── Types derived from SettingsConfig ──

type LocalEntry = SettingsConfig['locals'][number];

// ── Local editing state ──

type BindingMode = 'literal' | 'expression';

type LocalRow = {
  name: string;
  mode: BindingMode;
  litValue: string;
  exprValue: string;
};

function toRows(locals: LocalEntry[] | undefined): LocalRow[] {
  if (!locals) return [];
  return locals.map((l) => ({
    name: l.name,
    mode: l.mode === 'expression' ? 'expression' : 'literal',
    litValue: l.mode !== 'expression' ? l.value_display : '',
    exprValue: l.mode === 'expression' ? l.value_display : '',
  }));
}

function fromRows(rows: LocalRow[]): LocalEntry[] {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      mode: r.mode,
      value_display: r.mode === 'expression' ? r.exprValue : r.litValue,
    }));
}

// ── Content-only component (used by UnifiedSettingsPanel) ──

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type ContentProps = {
  locals: LocalEntry[] | undefined;
  onSave: (locals: LocalEntry[]) => void | Promise<void>;
};

export function LocalsContent({ locals, onSave }: ContentProps) {
  const [rows, setRows] = useState<LocalRow[]>(() => toRows(locals));

  const addLocal = useCallback(() => {
    setRows((prev) => [...prev, { name: '', mode: 'literal', litValue: '', exprValue: '' }]);
  }, []);

  const removeLocal = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateName = useCallback((index: number, name: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, name } : r)));
  }, []);

  const switchMode = useCallback((index: number, mode: BindingMode) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, mode } : r)));
  }, []);

  const updateLitValue = useCallback((index: number, litValue: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, litValue } : r)));
  }, []);

  const updateExprValue = useCallback((index: number, exprValue: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, exprValue } : r)));
  }, []);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await onSave(fromRows(rows));
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  };

  // ── Validation ──

  const nameErrors: Record<number, string> = {};
  rows.forEach((r, i) => {
    if (r.name.trim() && !isValidTerraformIdentifier(r.name.trim())) {
      nameErrors[i] = 'Invalid Terraform identifier';
    }
  });

  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className={rowCardClasses}>
          {/* Name */}
          <div className="flex gap-2 mb-2">
            <input
              value={row.name}
              onChange={(e) => updateName(i, e.target.value)}
              placeholder="Local name"
              className={`${inputClasses} flex-1 font-mono ${nameErrors[i] ? 'border-[#e5484d]' : ''}`}
            />
            <button onClick={() => removeLocal(i)} className={removeButtonClasses}>
              ✕
            </button>
          </div>
          {nameErrors[i] && <div className="text-[10px] text-[#e5484d] mb-2">{nameErrors[i]}</div>}

          {/* Mode selector */}
          <div className="flex gap-1 mb-2">
            <button
              className={`${modeButtonBase} ${row.mode === 'literal' ? modeButtonActive : modeButtonInactive}`}
              onClick={() => switchMode(i, 'literal')}
            >
              Literal
            </button>
            <button
              className={`${modeButtonBase} ${row.mode === 'expression' ? modeButtonActive : modeButtonInactive}`}
              onClick={() => switchMode(i, 'expression')}
            >
              Expression
            </button>
          </div>

          {/* Value editor */}
          {row.mode === 'literal' ? (
            <textarea
              value={row.litValue}
              onChange={(e) => updateLitValue(i, e.target.value)}
              placeholder='e.g. "my-bucket" or {"key": "value"}'
              rows={3}
              className={`${inputClasses} font-mono resize-y`}
            />
          ) : (
            <textarea
              value={row.exprValue}
              onChange={(e) => updateExprValue(i, e.target.value)}
              placeholder='e.g. "${var.environment}-${var.role_name}"'
              rows={3}
              className={`${inputClasses} font-mono resize-y`}
            />
          )}
        </div>
      ))}

      <button onClick={addLocal} className={addButtonClasses}>
        + Add local
      </button>

      {/* Inline save */}
      <button
        className={
          saveStatus === 'saving'
            ? saveButtonSavingClasses
            : saveStatus === 'saved'
              ? saveButtonSuccessClasses
              : saveStatus === 'error'
                ? saveButtonErrorClasses
                : saveButtonClasses
        }
        onClick={handleSave}
        disabled={saveStatus === 'saving'}
      >
        {saveStatus === 'saving'
          ? 'Saving...'
          : saveStatus === 'saved'
            ? 'Saved!'
            : saveStatus === 'error'
              ? 'Save failed — try again'
              : 'Save locals'}
      </button>
    </>
  );
}

// ── Full panel (backwards compat — original default export) ──

type Props = {
  locals: LocalEntry[] | undefined;
  onSave: (locals: LocalEntry[]) => void | Promise<void>;
  onClose: () => void;
};

export default function LocalsPanel({ locals, onSave, onClose }: Props) {
  return (
    <PanelFrame title="Locals" onClose={onClose}>
      <LocalsContent locals={locals} onSave={onSave} />
    </PanelFrame>
  );
}
