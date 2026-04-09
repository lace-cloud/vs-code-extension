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

type ContentProps = {
  locals: LocalEntry[] | undefined;
  onSave: (locals: LocalEntry[]) => void;
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

  const handleSave = () => {
    if (hasErrors) return;
    onSave(fromRows(rows));
  };

  // ── Validation ──

  const nameErrors: Record<number, string> = {};
  rows.forEach((r, i) => {
    if (r.name.trim() && !isValidTerraformIdentifier(r.name.trim())) {
      nameErrors[i] = 'Invalid Terraform identifier';
    }
  });

  // Duplicate local name check
  const seenNames = new Map<string, number>();
  rows.forEach((r, i) => {
    const n = r.name.trim().toLowerCase();
    if (!n) return;
    if (seenNames.has(n)) {
      nameErrors[i] = 'Duplicate local name';
      const prev = seenNames.get(n)!;
      if (!nameErrors[prev]) nameErrors[prev] = 'Duplicate local name';
    }
    seenNames.set(n, i);
  });

  const hasErrors = Object.keys(nameErrors).length > 0;

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
        className={saveButtonClasses}
        onClick={handleSave}
        disabled={hasErrors}
        title={hasErrors ? 'Fix errors before saving' : undefined}
        style={hasErrors ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      >
        Save locals
      </button>
    </>
  );
}

// ── Full panel (backwards compat — original default export) ──

type Props = {
  locals: LocalEntry[] | undefined;
  onSave: (locals: LocalEntry[]) => void;
  onClose: () => void;
};

export default function LocalsPanel({ locals, onSave, onClose }: Props) {
  return (
    <PanelFrame title="Locals" onClose={onClose}>
      <LocalsContent locals={locals} onSave={onSave} />
    </PanelFrame>
  );
}
