// src/webview/components/panels/ModuleConfigPanel.tsx
import React, { useMemo, useState } from 'react';
import type { InputDef, OutputDef, Binding } from '../../types/ir';
import { isLit, isOut, isVar, isExpr } from '../../types/ir';

// ── Props ──

type Props = {
  instance_id: string;
  schema: { inputs: InputDef[]; outputs: OutputDef[] };
  inputs: Record<string, Binding>;
  onSave: (inputs: Record<string, Binding>) => void;
  onClose: () => void;
};

// ── Shared styles ──

const inputClasses =
  'w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs';

// ── Component ──

export default function ModuleConfigPanel({ instance_id, schema, inputs, onSave, onClose }: Props) {
  // Local state: track literal values being edited
  const [litValues, setLitValues] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    for (const [name, binding] of Object.entries(inputs)) {
      if (isLit(binding)) {
        initial[name] = binding.lit;
      }
    }
    return initial;
  });

  const [showOptional, setShowOptional] = useState(true);

  const updateValue = (key: string, value: any) => {
    setLitValues((prev) => ({ ...prev, [key]: value }));
  };

  // ── Split inputs into required / optional ──

  const { requiredInputs, optionalInputs } = useMemo(
    () => ({
      requiredInputs: (schema.inputs ?? []).filter((i) => i.required),
      optionalInputs: (schema.inputs ?? []).filter((i) => !i.required),
    }),
    [schema.inputs],
  );

  // ── Save handler: produce Record<string, Binding> ──

  const handleSave = () => {
    const result: Record<string, Binding> = { ...inputs };
    for (const [name, value] of Object.entries(litValues)) {
      result[name] = { lit: value };
    }
    onSave(result);
  };

  // ── Describe non-literal binding (read-only) ──

  function describeBinding(binding: Binding): string | null {
    if (isOut(binding)) {
      return `Wired to ${binding.out.module}.${binding.out.name}`;
    }
    if (isVar(binding)) {
      return `Variable: var.${binding.var}`;
    }
    if (isExpr(binding)) {
      return `Expression: ${binding.expr.value}`;
    }
    return null;
  }

  // ── Render a single input field ──

  function renderInputField(def: InputDef): React.ReactNode {
    const binding = inputs[def.name];
    const nonLitDesc = binding ? describeBinding(binding) : null;

    // If bound to out/var/expr, show read-only
    if (binding && !isLit(binding) && nonLitDesc) {
      return (
        <div key={def.name} className="mb-4 flex flex-col gap-1.5">
          <label className="text-xs font-semibold opacity-90">
            {def.name}
            {def.required && <span className="text-[#e5484d] ml-1">*</span>}
          </label>
          <div className="flex gap-2 items-center">
            <input value={nonLitDesc} readOnly className={`${inputClasses} font-mono opacity-95`} />
            <span className="text-[11px] px-2.5 py-1.5 rounded-full border border-[#2b4a7a] bg-[#0b1f3a] text-[#9ecbff] font-bold whitespace-nowrap">
              Wired
            </span>
          </div>
          {def.description && <div className="text-[11px] opacity-60">{def.description}</div>}
        </div>
      );
    }

    // Literal mode editor based on type
    const value = litValues[def.name] ?? def.default ?? null;
    const type = def.type || 'string';

    let editor: React.ReactNode;

    if (type === 'bool') {
      editor = (
        <select
          value={String(value ?? false)}
          onChange={(e) => updateValue(def.name, e.target.value === 'true')}
          className={inputClasses}
        >
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    } else if (type === 'number') {
      editor = (
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) =>
            updateValue(def.name, e.target.value === '' ? '' : Number(e.target.value))
          }
          className={inputClasses}
        />
      );
    } else if (
      type.startsWith('list(') ||
      type.startsWith('map(') ||
      type.startsWith('set(') ||
      type.startsWith('object(')
    ) {
      // Complex types: JSON textarea
      const jsonStr = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
      editor = (
        <textarea
          value={jsonStr}
          onChange={(e) => {
            try {
              updateValue(def.name, JSON.parse(e.target.value));
            } catch {
              // Keep raw string while user is typing
              updateValue(def.name, e.target.value);
            }
          }}
          rows={4}
          className={`${inputClasses} font-mono resize-y`}
        />
      );
    } else {
      // Default: string input
      editor = (
        <input
          value={value ?? ''}
          onChange={(e) => updateValue(def.name, e.target.value)}
          className={inputClasses}
        />
      );
    }

    return (
      <div key={def.name} className="mb-4 flex flex-col gap-1.5">
        <label className="text-xs font-semibold opacity-90">
          {def.name}
          {def.required && <span className="text-[#e5484d] ml-1">*</span>}
        </label>
        {editor}
        {def.description && <div className="text-[11px] opacity-60">{def.description}</div>}
      </div>
    );
  }

  return (
    <div className="absolute right-0 top-0 w-[420px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col z-20">
      {/* Header */}
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        <div className="flex flex-col gap-1">
          <div className="text-xs opacity-70">Module</div>
          <h3 className="m-0 text-base">{instance_id}</h3>
        </div>
        <button
          onClick={onClose}
          className="cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-lg w-[34px] h-[34px]"
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {/* Required Inputs */}
        {requiredInputs.length > 0 && (
          <>
            <SectionTitle label="Required Inputs" />
            {requiredInputs.map(renderInputField)}
          </>
        )}

        {/* Optional Inputs */}
        {optionalInputs.length > 0 && (
          <>
            <div
              className={`flex items-center justify-between ${requiredInputs.length > 0 ? 'mt-4' : ''}`}
            >
              <SectionTitle label="Optional Inputs" className="mb-0" />
              <button
                onClick={() => setShowOptional((v) => !v)}
                className="cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-full px-2.5 py-1.5 text-xs opacity-90"
              >
                {showOptional ? 'Hide' : 'Show'} ({optionalInputs.length})
              </button>
            </div>
            <div className="h-2.5" />
            {showOptional && optionalInputs.map(renderInputField)}
          </>
        )}

        {/* Outputs */}
        {schema.outputs.length > 0 && (
          <>
            <SectionTitle label="Outputs" style={{ marginTop: 26 }} />
            {schema.outputs.map((o) => (
              <div
                key={o.name}
                className="mb-2.5 text-xs opacity-85 bg-[#0f0f0f] border border-[#333] rounded-[10px] px-2.5 py-2.5"
              >
                <div className="flex justify-between gap-2.5">
                  <strong className="text-xs">{o.name}</strong>
                  <span className="font-mono opacity-75 text-[11px]">{o.type ?? ''}</span>
                </div>
                {o.description && (
                  <div className="mt-1.5 text-[11px] opacity-70">{o.description}</div>
                )}
                {o.sensitive && (
                  <div className="mt-1 text-[10px] text-yellow-400 opacity-80">⚠ sensitive</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="p-4 border-t border-[#333] bg-[#1e1e1e] sticky bottom-0 z-30">
        <button
          className="w-full py-3 bg-[#1f6feb] text-white border-none rounded-[10px] font-bold text-sm cursor-pointer"
          onClick={handleSave}
        >
          Save configuration
        </button>
      </footer>
    </div>
  );
}

// ── Section Title ──

function SectionTitle({
  label,
  style = {},
  className = '',
}: {
  label: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <h4
      className={`m-0 mb-3 text-[13px] font-bold uppercase tracking-wide opacity-85 ${className}`}
      style={style}
    >
      {label}
    </h4>
  );
}
