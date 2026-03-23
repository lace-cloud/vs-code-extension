// src/webview/components/panels/ModuleConfigPanel.tsx
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import type { RenderInput, RenderOutput, NodeConfig } from '../../types/render';
import type { CanvasEngine } from '../../engine';
import AccordionSection from '../AccordionSection';
import PanelFrame from '../PanelFrame';
import {
  inputClasses,
  modeButtonBase,
  modeButtonActive,
  modeButtonInactive,
  footerSaveButtonClasses,
} from '../../styles/panel';

// ── Binding mode type ──

type BindingMode = 'empty' | 'literal' | 'variable' | 'expression' | 'wired';

// ── Props ──

type Props = {
  instance_id: string;
  engine: CanvasEngine;
  onClose: () => void;
};

// ── Component ──

export default function ModuleConfigPanel({ instance_id, engine, onClose }: Props) {
  const { state, updateView } = useCanvas();
  const [config, setConfig] = useState<NodeConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // Local state: tracks changes per input name
  const [localModes, setLocalModes] = useState<Record<string, BindingMode>>({});
  const [localValues, setLocalValues] = useState<Record<string, unknown>>({});
  const [localVariables, setLocalVariables] = useState<Record<string, string>>({});
  const [localExpressions, setLocalExpressions] = useState<Record<string, string>>({});

  // depends_on local state
  const [localDependsOn, setLocalDependsOn] = useState<Set<string>>(new Set());

  // Fetch config from engine
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    engine
      .queryNodeConfig(instance_id)
      .then((result) => {
        if (cancelled) return;
        setConfig(result);
        setLoading(false);

        // Initialize local state from fetched config
        const modes: Record<string, BindingMode> = {};
        const values: Record<string, unknown> = {};
        const variables: Record<string, string> = {};
        const expressions: Record<string, string> = {};

        for (const input of result.inputs) {
          modes[input.name] = input.mode;
          if (input.value !== undefined) values[input.name] = input.value;
          if (input.variable) variables[input.name] = input.variable;
          if (input.expression) expressions[input.name] = input.expression;
        }

        setLocalModes(modes);
        setLocalValues(values);
        setLocalVariables(variables);
        setLocalExpressions(expressions);
        setLocalDependsOn(new Set(result.depends_on));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(`[ModuleConfigPanel] queryNodeConfig failed for "${instance_id}":`, err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instance_id, engine, state.generation]);

  const switchMode = useCallback(
    (name: string, mode: BindingMode, input: RenderInput) => {
      setLocalModes((prev) => ({ ...prev, [name]: mode }));
      switch (mode) {
        case 'literal':
          setLocalValues((prev) => ({ ...prev, [name]: input.default_value ?? null }));
          break;
        case 'variable':
          setLocalVariables((prev) => ({ ...prev, [name]: '' }));
          break;
        case 'expression':
          setLocalExpressions((prev) => ({ ...prev, [name]: '' }));
          break;
        case 'empty':
          setLocalValues((prev) => {
            const next = { ...prev };
            delete next[name];
            return next;
          });
          break;
        case 'wired':
          // Cannot switch to wired manually
          break;
      }
    },
    [config],
  );

  // ── Split inputs ──

  const { requiredInputs, optionalInputs } = useMemo(
    () => ({
      requiredInputs: (config?.inputs ?? []).filter((i) => i.required),
      optionalInputs: (config?.inputs ?? []).filter((i) => !i.required),
    }),
    [config?.inputs],
  );

  // ── Save handler ──

  const handleSave = async () => {
    if (!config) return;

    for (const input of config.inputs) {
      const mode = localModes[input.name] ?? input.mode;
      if (mode === 'wired') continue;
      await engine.updateInput(
        instance_id,
        input.name,
        mode,
        mode === 'literal' ? localValues[input.name] : undefined,
        mode === 'variable' ? localVariables[input.name] : undefined,
        mode === 'expression' ? localExpressions[input.name] : undefined,
      );
    }
    await engine.setDependsOn(instance_id, [...localDependsOn]);
    onClose();
  };

  // ── Disconnect handler ──

  const handleDisconnect = async (inputName: string) => {
    const result = await engine.disconnect(instance_id, inputName);
    updateView(result);
    // Refresh config after disconnect
    const updated = await engine.queryNodeConfig(instance_id);
    setConfig(updated);
    // Reset mode for that input
    const input = updated.inputs.find((i) => i.name === inputName);
    if (input) {
      setLocalModes((prev) => ({ ...prev, [inputName]: input.mode }));
    }
  };

  // ── Mode selector ──

  function renderModeSelector(input: RenderInput): React.ReactNode {
    const currentMode = localModes[input.name] ?? input.mode;
    const isWired = currentMode === 'wired';

    const buttons: { mode: BindingMode; label: string; disabled?: boolean }[] = [
      { mode: 'literal', label: 'Lit', disabled: isWired },
      { mode: 'variable', label: 'Var', disabled: isWired },
      { mode: 'expression', label: 'Expr', disabled: isWired },
      { mode: 'wired', label: 'Wired', disabled: true },
    ];

    return (
      <div className="flex gap-1 mb-2">
        {buttons.map((btn) => (
          <button
            key={btn.mode}
            className={`${modeButtonBase} ${currentMode === btn.mode ? modeButtonActive : modeButtonInactive} ${btn.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            onClick={() => {
              if (!btn.disabled) switchMode(input.name, btn.mode, input);
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

  function renderInputField(input: RenderInput): React.ReactNode {
    const currentMode = localModes[input.name] ?? input.mode;

    return (
      <div key={input.name} className="mb-4 flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-[#e6e6e6]">
          {input.name}
          {input.required && <span className="text-[#e5484d] ml-1">*</span>}
        </label>

        {/* Mode selector */}
        {renderModeSelector(input)}

        {/* Mode-specific editor */}
        {currentMode === 'wired' && renderWiredEditor(input)}
        {currentMode === 'variable' && renderVariableEditor(input)}
        {currentMode === 'expression' && renderExpressionEditor(input)}
        {currentMode === 'literal' && renderLiteralEditor(input)}

        {input.description && <div className="text-[11px] text-[#9ca3af]">{input.description}</div>}
      </div>
    );
  }

  // ── Wired mode (read-only with disconnect button) ──

  function renderWiredEditor(input: RenderInput): React.ReactNode {
    const label = input.wired_source ?? 'Not wired';
    return (
      <div className="flex gap-2 items-center">
        <input value={label} readOnly className={`${inputClasses} font-mono opacity-95`} />
        <span className="text-[11px] px-2.5 py-1.5 rounded-full border border-[#2b4a7a] bg-[#0b1f3a] text-[#9ecbff] font-bold whitespace-nowrap">
          Wired
        </span>
        <button
          onClick={() => handleDisconnect(input.name)}
          className="text-[11px] px-2 py-1.5 rounded-full border border-[#e5484d] bg-transparent text-[#e5484d] cursor-pointer hover:bg-[#e5484d] hover:text-white transition-colors duration-100 font-bold whitespace-nowrap"
          title="Disconnect this input"
        >
          ✕
        </button>
      </div>
    );
  }

  // ── Variable mode ──

  function renderVariableEditor(input: RenderInput): React.ReactNode {
    const currentVar = localVariables[input.name] ?? input.variable ?? '';

    return (
      <input
        value={currentVar}
        onChange={(e) => {
          // Strip "var." prefix if user types it — we store just the name
          const raw = e.target.value;
          const name = raw.startsWith('var.') ? raw.slice(4) : raw;
          setLocalVariables((prev) => ({ ...prev, [input.name]: name }));
        }}
        placeholder="e.g. region"
        className={`${inputClasses} font-mono`}
      />
    );
  }

  // ── Expression mode ──

  function renderExpressionEditor(input: RenderInput): React.ReactNode {
    const currentExpr = localExpressions[input.name] ?? input.expression ?? '';

    return (
      <textarea
        value={currentExpr}
        onChange={(e) => setLocalExpressions((prev) => ({ ...prev, [input.name]: e.target.value }))}
        rows={3}
        placeholder={'e.g. join("-", [var.prefix, var.name])'}
        className={`${inputClasses} font-mono resize-y`}
      />
    );
  }

  // ── Literal mode ──

  function renderLiteralEditor(input: RenderInput): React.ReactNode {
    const value = localValues[input.name] ?? input.value ?? input.default_value ?? null;
    const type = input.type || 'string';

    const updateValue = (val: unknown) => {
      setLocalValues((prev) => ({ ...prev, [input.name]: val }));
    };

    if (type === 'bool') {
      return (
        <select
          value={String(value ?? false)}
          onChange={(e) => updateValue(e.target.value === 'true')}
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
          value={String(value ?? '')}
          onChange={(e) => updateValue(e.target.value === '' ? '' : Number(e.target.value))}
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
              updateValue(JSON.parse(e.target.value));
            } catch {
              updateValue(e.target.value);
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
        value={String(value ?? '')}
        onChange={(e) => {
          let v = e.target.value;
          // Strip wrapping quotes — the CLI handles HCL quoting automatically.
          if (
            v.length >= 2 &&
            ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))
          ) {
            v = v.slice(1, -1);
          }
          updateValue(v);
        }}
        className={inputClasses}
      />
    );
  }

  if (error) {
    return (
      <PanelFrame title="Error" onClose={onClose}>
        <div className="text-xs text-red-400">
          Failed to load configuration for "{instance_id}":
        </div>
        <div className="text-xs text-red-300 mt-1 break-all">{error}</div>
      </PanelFrame>
    );
  }

  if (loading || !config) {
    return (
      <PanelFrame title="Loading..." onClose={onClose}>
        <div className="text-xs opacity-60">Loading configuration...</div>
      </PanelFrame>
    );
  }

  // ── Depends On count ──
  const dependsOnCount = localDependsOn.size;

  const title = (
    <div className="flex flex-col gap-1">
      <div className="text-xs opacity-70">Module</div>
      <h3 className="m-0 text-base">{instance_id}</h3>
    </div>
  );

  const footer = (
    <button className={footerSaveButtonClasses} onClick={handleSave}>
      Save configuration
    </button>
  );

  return (
    <PanelFrame title={title} footer={footer} scrollable={false} onClose={onClose}>
      {/* Required Inputs */}
      {requiredInputs.length > 0 && (
        <AccordionSection title="Required Inputs" defaultOpen badge={`(${requiredInputs.length})`}>
          {requiredInputs.map(renderInputField)}
        </AccordionSection>
      )}

      {/* Optional Inputs */}
      {optionalInputs.length > 0 && (
        <AccordionSection title="Optional Inputs" defaultOpen badge={`(${optionalInputs.length})`}>
          {optionalInputs.map(renderInputField)}
        </AccordionSection>
      )}

      {/* Depends On */}
      {config.sibling_ids.length > 0 && (
        <AccordionSection
          title="Depends On"
          badge={dependsOnCount > 0 ? `(${dependsOnCount})` : undefined}
        >
          <div className="text-[11px] opacity-60 mb-2">
            Select sibling instances this module depends on.
          </div>
          {config.sibling_ids.map((sibId) => {
            const depKey = `module.${sibId}`;
            return (
              <label key={sibId} className="flex items-center gap-2 mb-1.5 text-xs cursor-pointer">
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
        </AccordionSection>
      )}

      {/* Outputs */}
      {config.outputs.length > 0 && (
        <AccordionSection title="Outputs" badge={`(${config.outputs.length})`}>
          {config.outputs.map((o: RenderOutput) => (
            <div
              key={o.name}
              className="mb-2.5 text-xs opacity-85 bg-[#0f0f0f] border border-[#333] rounded-[10px] px-2.5 py-2.5"
            >
              <div className="flex justify-between gap-2.5">
                <strong className="text-xs">{o.name}</strong>
                <span className="font-mono opacity-75 text-[11px]">{o.type ?? ''}</span>
              </div>
              {o.description && (
                <div className="mt-1.5 text-[11px] text-[#9ca3af]">{o.description}</div>
              )}
              {o.sensitive && (
                <div className="mt-1 text-[10px] text-yellow-400 opacity-80">sensitive</div>
              )}
            </div>
          ))}
        </AccordionSection>
      )}
    </PanelFrame>
  );
}
