// src/webview/components/panels/ModuleConfigPanel.tsx
import React, { useMemo, useState, useCallback } from 'react';
import type { InputDef, OutputDef, Binding } from '../../types/ir';
import { isLit, isOut, isVar, isExpr } from '../../types/ir';

// ── Binding mode type ──

type BindingMode = 'literal' | 'variable' | 'expression' | 'wired';

function detectMode(binding: Binding | undefined): BindingMode {
  if (!binding) return 'literal';
  if (isOut(binding)) return 'wired';
  if (isVar(binding)) return 'variable';
  if (isExpr(binding)) return 'expression';
  return 'literal';
}

/**
 * Returns true when a literal value is an untouched placeholder default.
 * These should be omitted for optional inputs so Terraform uses the
 * module's own defaults instead of emitting `= {}` or `= null`.
 */
function isEmptyLit(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) {
    return true;
  }
  return false;
}

// ── Props ──

type Props = {
  instance_id: string;
  schema: { inputs: InputDef[]; outputs: OutputDef[] };
  inputs: Record<string, Binding>;
  /** Composite's interface.inputs — for the Variable mode dropdown */
  composite_variables: InputDef[];
  /** IDs of sibling instances in the same composite (for depends_on) */
  sibling_ids: string[];
  /** Current depends_on value */
  depends_on: string[] | undefined;
  onSave: (inputs: Record<string, Binding>) => void;
  onSaveDependsOn: (depends_on: string[]) => void;
  onDisconnect: (input_name: string) => void;
  onClose: () => void;
};

// ── Shared styles ──

const inputClasses =
  'w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs';

const modeButtonBase =
  'text-[10px] px-2 py-1 rounded cursor-pointer border transition-colors duration-100';

const modeButtonActive = 'bg-[#1f6feb] border-[#1f6feb] text-white font-bold';

const modeButtonInactive =
  'bg-transparent border-[#555] text-[#999] hover:text-white hover:border-[#888]';

// ── Component ──

export default function ModuleConfigPanel({
  instance_id,
  schema,
  inputs,
  composite_variables,
  sibling_ids,
  depends_on,
  onSave,
  onSaveDependsOn,
  onDisconnect,
  onClose,
}: Props) {
  // Local state: tracks the current binding per input name
  const [localBindings, setLocalBindings] = useState<Record<string, Binding>>(() => ({
    ...inputs,
  }));

  // depends_on local state
  const [localDependsOn, setLocalDependsOn] = useState<Set<string>>(
    () => new Set(depends_on ?? []),
  );

  // Track modes explicitly so switching modes can create appropriate defaults
  const [modes, setModes] = useState<Record<string, BindingMode>>(() => {
    const m: Record<string, BindingMode> = {};
    for (const def of schema.inputs ?? []) {
      m[def.name] = detectMode(inputs[def.name]);
    }
    return m;
  });

  const [showOptional, setShowOptional] = useState(true);

  const updateBinding = useCallback((name: string, binding: Binding) => {
    setLocalBindings((prev) => ({ ...prev, [name]: binding }));
  }, []);

  const switchMode = useCallback(
    (name: string, mode: BindingMode, def: InputDef) => {
      setModes((prev) => ({ ...prev, [name]: mode }));
      // Create appropriate default binding for the new mode
      switch (mode) {
        case 'literal':
          setLocalBindings((prev) => ({ ...prev, [name]: { lit: def.default ?? null } }));
          break;
        case 'variable':
          setLocalBindings((prev) => ({
            ...prev,
            [name]: { var: composite_variables[0]?.name ?? '' },
          }));
          break;
        case 'expression':
          setLocalBindings((prev) => ({
            ...prev,
            [name]: { expr: { lang: 'hcl', value: '' } },
          }));
          break;
        case 'wired':
          // Cannot switch to wired manually — it's set by CONNECT action
          break;
      }
    },
    [composite_variables],
  );

  // ── Split inputs ──

  const { requiredInputs, optionalInputs } = useMemo(
    () => ({
      requiredInputs: (schema.inputs ?? []).filter((i) => i.required),
      optionalInputs: (schema.inputs ?? []).filter((i) => !i.required),
    }),
    [schema.inputs],
  );

  // ── Save handler ──

  const handleSave = () => {
    // Filter out optional inputs whose literal value is an untouched placeholder
    // (null or empty object). Omitting them lets Terraform use the module's own
    // defaults instead of emitting invalid `= {}` in HCL.
    const optionalNames = new Set(optionalInputs.map((i) => i.name));
    const filtered: Record<string, Binding> = {};
    for (const [name, binding] of Object.entries(localBindings)) {
      if (optionalNames.has(name) && isLit(binding) && isEmptyLit(binding.lit)) {
        continue;
      }
      filtered[name] = binding;
    }
    onSave(filtered);
    onSaveDependsOn([...localDependsOn]);
  };

  // ── Mode selector ──

  function renderModeSelector(def: InputDef): React.ReactNode {
    const currentMode = modes[def.name] ?? 'literal';
    const isWired = currentMode === 'wired';

    const buttons: { mode: BindingMode; label: string; disabled?: boolean }[] = [
      { mode: 'literal', label: 'Lit', disabled: isWired },
      { mode: 'variable', label: 'Var', disabled: isWired || composite_variables.length === 0 },
      { mode: 'expression', label: 'Expr', disabled: isWired },
      { mode: 'wired', label: 'Wired', disabled: true }, // Always disabled — set by CONNECT
    ];

    return (
      <div className="flex gap-1 mb-2">
        {buttons.map((btn) => (
          <button
            key={btn.mode}
            className={`${modeButtonBase} ${currentMode === btn.mode ? modeButtonActive : modeButtonInactive} ${btn.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            onClick={() => {
              if (!btn.disabled) switchMode(def.name, btn.mode, def);
            }}
            disabled={btn.disabled}
          >
            {btn.label}
          </button>
        ))}
      </div>
    );
  }

  // ── Render a single input field based on mode ──

  function renderInputField(def: InputDef): React.ReactNode {
    const currentMode = modes[def.name] ?? 'literal';
    const binding = localBindings[def.name];

    return (
      <div key={def.name} className="mb-4 flex flex-col gap-1.5">
        <label className="text-xs font-semibold opacity-90">
          {def.name}
          {def.required && <span className="text-[#e5484d] ml-1">*</span>}
        </label>

        {/* Mode selector */}
        {renderModeSelector(def)}

        {/* Mode-specific editor */}
        {currentMode === 'wired' && renderWiredEditor(def.name, binding)}
        {currentMode === 'variable' && renderVariableEditor(def, binding)}
        {currentMode === 'expression' && renderExpressionEditor(def, binding)}
        {currentMode === 'literal' && renderLiteralEditor(def, binding)}

        {def.description && <div className="text-[11px] opacity-60">{def.description}</div>}
      </div>
    );
  }

  // ── Wired mode (read-only with disconnect button) ──

  function renderWiredEditor(inputName: string, binding: Binding | undefined): React.ReactNode {
    const label =
      binding && isOut(binding) ? `${binding.out.module}.${binding.out.name}` : 'Not wired';
    return (
      <div className="flex gap-2 items-center">
        <input value={label} readOnly className={`${inputClasses} font-mono opacity-95`} />
        <span className="text-[11px] px-2.5 py-1.5 rounded-full border border-[#2b4a7a] bg-[#0b1f3a] text-[#9ecbff] font-bold whitespace-nowrap">
          Wired
        </span>
        <button
          onClick={() => onDisconnect(inputName)}
          className="text-[11px] px-2 py-1.5 rounded-full border border-[#e5484d] bg-transparent text-[#e5484d] cursor-pointer hover:bg-[#e5484d] hover:text-white transition-colors duration-100 font-bold whitespace-nowrap"
          title="Disconnect this input"
        >
          ✕
        </button>
      </div>
    );
  }

  // ── Variable mode ──

  function renderVariableEditor(def: InputDef, binding: Binding | undefined): React.ReactNode {
    const currentVar = binding && isVar(binding) ? binding.var : '';

    return (
      <select
        value={currentVar}
        onChange={(e) => updateBinding(def.name, { var: e.target.value })}
        className={inputClasses}
      >
        <option value="" disabled>
          Select variable…
        </option>
        {composite_variables.map((v) => (
          <option key={v.name} value={v.name}>
            var.{v.name} ({v.type})
          </option>
        ))}
      </select>
    );
  }

  // ── Expression mode ──

  function renderExpressionEditor(def: InputDef, binding: Binding | undefined): React.ReactNode {
    const currentExpr = binding && isExpr(binding) ? binding.expr.value : '';

    return (
      <textarea
        value={currentExpr}
        onChange={(e) => updateBinding(def.name, { expr: { lang: 'hcl', value: e.target.value } })}
        rows={3}
        placeholder={'e.g. join("-", [var.prefix, var.name])'}
        className={`${inputClasses} font-mono resize-y`}
      />
    );
  }

  // ── Literal mode ──

  function renderLiteralEditor(def: InputDef, binding: Binding | undefined): React.ReactNode {
    const value = binding && isLit(binding) ? binding.lit : (def.default ?? null);
    const type = def.type || 'string';

    if (type === 'bool') {
      return (
        <select
          value={String(value ?? false)}
          onChange={(e) => updateBinding(def.name, { lit: e.target.value === 'true' })}
          className={inputClasses}
        >
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    }

    if (type === 'number') {
      return (
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) =>
            updateBinding(def.name, {
              lit: e.target.value === '' ? '' : Number(e.target.value),
            })
          }
          className={inputClasses}
        />
      );
    }

    if (
      type.startsWith('list(') ||
      type.startsWith('map(') ||
      type.startsWith('set(') ||
      type === 'object' ||
      type.startsWith('object(')
    ) {
      const jsonStr = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
      return (
        <textarea
          value={jsonStr}
          onChange={(e) => {
            try {
              updateBinding(def.name, { lit: JSON.parse(e.target.value) });
            } catch {
              updateBinding(def.name, { lit: e.target.value });
            }
          }}
          rows={4}
          className={`${inputClasses} font-mono resize-y`}
        />
      );
    }

    // Default: string
    return (
      <input
        value={value ?? ''}
        onChange={(e) => {
          let v = e.target.value;
          // Strip wrapping quotes — the CLI handles HCL quoting automatically.
          // Without this, typing "" stores the two-character string "" which the
          // CLI then quotes again, producing the invalid HCL literal "\"\"".
          if (
            v.length >= 2 &&
            ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))
          ) {
            v = v.slice(1, -1);
          }
          updateBinding(def.name, { lit: v });
        }}
        className={inputClasses}
      />
    );
  }

  return (
    <div className="w-[420px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col">
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

        {/* depends_on */}
        {sibling_ids.length > 0 && (
          <>
            <SectionTitle label="Depends On" style={{ marginTop: 26 }} />
            <div className="text-[11px] opacity-60 mb-2">
              Select sibling instances this module depends on.
            </div>
            {sibling_ids.map((sibId) => {
              const depKey = `module.${sibId}`;
              return (
                <label
                  key={sibId}
                  className="flex items-center gap-2 mb-1.5 text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={localDependsOn.has(depKey)}
                    onChange={(e) => {
                      setLocalDependsOn((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(depKey);
                        else next.delete(depKey);
                        return next;
                      });
                    }}
                    className="accent-[#1f6feb]"
                  />
                  <span className="font-mono opacity-90">{depKey}</span>
                </label>
              );
            })}
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
