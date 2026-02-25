// src/webview/components/panels/LocalsPanel.tsx
import React, { useState, useCallback } from 'react';
import type { LocalDef, Binding } from '../../types/ir';
import { isLit, isExpr } from '../../types/ir';
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

// ── Local editing state ──

type BindingMode = 'literal' | 'expression';

type LocalRow = {
  name: string;
  mode: BindingMode;
  litValue: string;
  exprValue: string;
};

function detectMode(binding: Binding): BindingMode {
  if (isExpr(binding)) return 'expression';
  return 'literal';
}

function toRows(locals: LocalDef[] | undefined): LocalRow[] {
  if (!locals) return [];
  return locals.map((l) => ({
    name: l.name,
    mode: detectMode(l.value),
    litValue: isLit(l.value)
      ? typeof l.value.lit === 'string'
        ? l.value.lit
        : JSON.stringify(l.value.lit, null, 2)
      : '',
    exprValue: isExpr(l.value) ? l.value.expr.value : '',
  }));
}

function fromRows(rows: LocalRow[]): LocalDef[] {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => {
      let value: Binding;
      if (r.mode === 'expression') {
        value = { expr: { lang: 'hcl', value: r.exprValue } };
      } else {
        // Try parsing as JSON for structured literals
        try {
          value = { lit: JSON.parse(r.litValue) };
        } catch {
          value = { lit: r.litValue };
        }
      }
      return { name: r.name.trim(), value };
    });
}

// ── Content-only component (used by UnifiedSettingsPanel) ──

type ContentProps = {
  locals: LocalDef[] | undefined;
  onSave: (locals: LocalDef[]) => void;
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
    onSave(fromRows(rows));
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
      <button className={saveButtonClasses} onClick={handleSave}>
        Save locals
      </button>
    </>
  );
}

// ── Full panel (backwards compat — original default export) ──

type Props = {
  locals: LocalDef[] | undefined;
  onSave: (locals: LocalDef[]) => void;
  onClose: () => void;
};

export default function LocalsPanel({ locals, onSave, onClose }: Props) {
  return (
    <PanelFrame title="Locals" onClose={onClose}>
      <LocalsContent locals={locals} onSave={onSave} />
    </PanelFrame>
  );
}
