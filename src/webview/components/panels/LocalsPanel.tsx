// src/webview/components/panels/LocalsPanel.tsx
import React, { useState, useCallback } from 'react';
import type { LocalDef, Binding } from '../../types/ir';
import { isLit, isExpr } from '../../types/ir';
import { isValidTerraformIdentifier } from '../../utils/identifiers';

// ── Shared styles ──

const inputClasses =
  'w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs';

const modeButtonBase =
  'text-[10px] px-2 py-1 rounded cursor-pointer border transition-colors duration-100';

const modeButtonActive = 'bg-[#1f6feb] border-[#1f6feb] text-white font-bold';

const modeButtonInactive =
  'bg-transparent border-[#555] text-[#999] hover:text-white hover:border-[#888]';

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
        <div key={i} className="mb-4 p-3 bg-[#0f0f0f] border border-[#333] rounded-lg">
          {/* Name */}
          <div className="flex gap-2 mb-2">
            <input
              value={row.name}
              onChange={(e) => updateName(i, e.target.value)}
              placeholder="Local name"
              className={`${inputClasses} flex-1 font-mono ${nameErrors[i] ? 'border-[#e5484d]' : ''}`}
            />
            <button
              onClick={() => removeLocal(i)}
              className="text-[#e5484d] text-xs px-2 cursor-pointer bg-transparent border-none"
            >
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

      <button
        onClick={addLocal}
        className="text-xs text-[#1f6feb] cursor-pointer bg-transparent border-none mb-4"
      >
        + Add local
      </button>

      {/* Inline save */}
      <button
        className="w-full py-2.5 bg-[#1f6feb] text-white border-none rounded-[10px] font-bold text-sm cursor-pointer mt-2"
        onClick={handleSave}
      >
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
    <div className="w-[420px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col">
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        <h3 className="m-0 text-base">Locals</h3>
        <button
          onClick={onClose}
          className="cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-lg w-[34px] h-[34px]"
          aria-label="Close"
        >
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        <LocalsContent locals={locals} onSave={onSave} />
      </div>
    </div>
  );
}
