// src/webview/components/panels/ModuleConfigPanel.tsx
import { Badge, Button, Input, ModeToggle, Panel, Textarea } from '@lace/ui';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CanvasEngine } from '../../engine';
import { useCanvas } from '../../state/engine-context';
import type { NodeConfig, RenderInput, RenderOutput } from '../../types/render';
import AccordionSection from '../AccordionSection';
import './ModuleConfigPanel.css';
import './panels-shared.css';

// ── Binding mode type ──

type BindingMode = 'empty' | 'literal' | 'variable' | 'expression' | 'wired';

const MODE_ITEMS: { value: BindingMode; label: string }[] = [
  { value: 'literal', label: 'Lit' },
  { value: 'variable', label: 'Var' },
  { value: 'expression', label: 'Expr' },
  { value: 'wired', label: 'Wired' },
];

// ── Props ──

type Props = {
  instance_id: string;
  engine: CanvasEngine;
  onClose: () => void;
  onModified?: (instanceId: string) => void;
};

// ── Component ──

export default function ModuleConfigPanel({ instance_id, engine, onClose, onModified }: Props) {
  const { state, updateView } = useCanvas();
  const [config, setConfig] = useState<NodeConfig | null>(null);
  const [loading, setLoading] = useState(true);

  type InputState = {
    modes: Record<string, BindingMode>;
    values: Record<string, unknown>;
    variables: Record<string, string>;
    expressions: Record<string, string>;
  };
  const [inputState, setInputState] = useState<InputState>({
    modes: {},
    values: {},
    variables: {},
    expressions: {},
  });

  const {
    modes: localModes,
    values: localValues,
    variables: localVariables,
    expressions: localExpressions,
  } = inputState;

  const setLocalModes = (fn: (prev: Record<string, BindingMode>) => Record<string, BindingMode>) =>
    setInputState((s) => ({ ...s, modes: fn(s.modes) }));
  const setLocalValues = (fn: (prev: Record<string, unknown>) => Record<string, unknown>) =>
    setInputState((s) => ({ ...s, values: fn(s.values) }));
  const setLocalVariables = (fn: (prev: Record<string, string>) => Record<string, string>) =>
    setInputState((s) => ({ ...s, variables: fn(s.variables) }));
  const setLocalExpressions = (fn: (prev: Record<string, string>) => Record<string, string>) =>
    setInputState((s) => ({ ...s, expressions: fn(s.expressions) }));

  const [localDependsOn, setLocalDependsOn] = useState<Set<string>>(new Set());

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

        setInputState({ modes, values, variables, expressions });
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

  const switchMode = useCallback((name: string, mode: BindingMode, input: RenderInput) => {
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
        // Cannot switch to wired manually.
        break;
    }
  }, []);

  const { requiredInputs, optionalInputs } = useMemo(
    () => ({
      requiredInputs: (config?.inputs ?? []).filter((i) => i.required),
      optionalInputs: (config?.inputs ?? []).filter((i) => !i.required),
    }),
    [config?.inputs],
  );

  const handleSave = async () => {
    if (!config) return;

    let lastView = state.view;
    for (const input of config.inputs) {
      const mode = localModes[input.name] ?? input.mode;
      if (mode === 'wired') continue;

      const result = await engine.updateInput(
        instance_id,
        input.name,
        mode,
        mode === 'literal' ? localValues[input.name] : undefined,
        mode === 'variable' ? localVariables[input.name] : undefined,
        mode === 'expression' ? localExpressions[input.name] : undefined,
      );
      lastView = result;
    }

    if (lastView && lastView !== state.view) {
      updateView(lastView);
    }
    await engine.setDependsOn(instance_id, [...localDependsOn]);

    const requiredToCheck = config.inputs.filter((i) => i.required);
    const hasFilledRequired =
      requiredToCheck.length === 0 ||
      requiredToCheck.some((input) => {
        const mode = localModes[input.name] ?? input.mode;
        if (mode === 'wired') return true;
        if (mode === 'literal') {
          const v = localValues[input.name];
          return v !== undefined && v !== null && v !== '';
        }
        if (mode === 'variable') {
          return (localVariables[input.name] ?? '').trim().length > 0;
        }
        if (mode === 'expression') {
          return (localExpressions[input.name] ?? '').trim().length > 0;
        }
        return false;
      });

    if (hasFilledRequired) {
      onModified?.(instance_id);
    }
    onClose();
  };

  const handleDisconnect = async (inputName: string) => {
    const result = await engine.disconnect(instance_id, inputName);
    updateView(result);
    const updated = await engine.queryNodeConfig(instance_id);
    setConfig(updated);
    const input = updated.inputs.find((i) => i.name === inputName);
    if (input) {
      setLocalModes((prev) => ({ ...prev, [inputName]: input.mode }));
    }
  };

  function renderModeSelector(input: RenderInput): React.ReactNode {
    const currentMode = localModes[input.name] ?? input.mode;
    const isWired = currentMode === 'wired';
    // Wired is always disabled (set by connect/disconnect). When the
    // current mode is wired, Lit/Var/Expr are also disabled so the user
    // can't silently overwrite a live binding.
    const items = MODE_ITEMS.map((m) => ({
      ...m,
      disabled: m.value === 'wired' || isWired,
    }));
    return (
      <ModeToggle<BindingMode>
        value={currentMode}
        onChange={(next) => switchMode(input.name, next, input)}
        items={items}
        aria-label={`${input.name} binding mode`}
      />
    );
  }

  function renderInputField(input: RenderInput): React.ReactNode {
    const currentMode = localModes[input.name] ?? input.mode;

    return (
      <div key={input.name} className="lace-panel-field">
        <label className="lace-panel-row-label">
          {input.name}
          {input.required && <span className="lace-mcp__required-star">*</span>}
        </label>

        {renderModeSelector(input)}

        <div className="lace-panel-row-content">
          {currentMode === 'wired' && renderWiredEditor(input)}
          {currentMode === 'variable' && renderVariableEditor(input)}
          {currentMode === 'expression' && renderExpressionEditor(input)}
          {currentMode === 'literal' && renderLiteralEditor(input)}
        </div>

        {input.description && (
          <div className="lace-panel-field__description">{input.description}</div>
        )}
      </div>
    );
  }

  function renderWiredEditor(input: RenderInput): React.ReactNode {
    const label = input.wired_source ?? 'Not wired';
    return (
      <div className="lace-mcp__wired-row">
        <div className="lace-mcp__wired-input">
          <Input value={label} readOnly fullWidth mono />
        </div>
        <Badge variant="info" size="md">
          Wired
        </Badge>
        <Button
          variant="danger"
          size="sm"
          onClick={() => handleDisconnect(input.name)}
          title="Disconnect this input"
          aria-label="Disconnect"
        >
          ✕
        </Button>
      </div>
    );
  }

  function renderVariableEditor(input: RenderInput): React.ReactNode {
    const currentVar = localVariables[input.name] ?? input.variable ?? '';
    return (
      <Input
        value={currentVar}
        onChange={(e) => {
          const raw = e.target.value;
          const name = raw.startsWith('var.') ? raw.slice(4) : raw;
          setLocalVariables((prev) => ({ ...prev, [input.name]: name }));
        }}
        placeholder="e.g. region"
        fullWidth
        mono
      />
    );
  }

  function renderExpressionEditor(input: RenderInput): React.ReactNode {
    const currentExpr = localExpressions[input.name] ?? input.expression ?? '';
    return (
      <Textarea
        value={currentExpr}
        onChange={(e) => setLocalExpressions((prev) => ({ ...prev, [input.name]: e.target.value }))}
        rows={3}
        placeholder='e.g. join("-", [var.prefix, var.name])'
        fullWidth
        mono
      />
    );
  }

  function renderLiteralEditor(input: RenderInput): React.ReactNode {
    const value = localValues[input.name] ?? input.value ?? input.default_value ?? null;
    const type = input.type || 'string';

    const updateValue = (val: unknown) => {
      setLocalValues((prev) => ({ ...prev, [input.name]: val }));
    };

    if (type === 'bool') {
      return (
        <select
          className="lace-mcp__select"
          value={String(value ?? false)}
          onChange={(e) => updateValue(e.target.value === 'true')}
        >
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    }

    if (type === 'number') {
      return (
        <Input
          type="number"
          value={String(value ?? '')}
          onChange={(e) => updateValue(e.target.value === '' ? '' : Number(e.target.value))}
          fullWidth
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
        <Textarea
          value={jsonStr}
          onChange={(e) => {
            try {
              updateValue(JSON.parse(e.target.value));
            } catch {
              updateValue(e.target.value);
            }
          }}
          rows={4}
          fullWidth
          mono
        />
      );
    }

    return (
      <Input
        value={String(value ?? '')}
        onChange={(e) => {
          let v = e.target.value;
          if (
            v.length >= 2 &&
            ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))
          ) {
            v = v.slice(1, -1);
          }
          updateValue(v);
        }}
        fullWidth
      />
    );
  }

  if (error) {
    return (
      <Panel title="Error" onClose={onClose}>
        <div className="lace-mcp__error-title">
          Failed to load configuration for "{instance_id}":
        </div>
        <div className="lace-mcp__error-detail">{error}</div>
      </Panel>
    );
  }

  if (loading || !config) {
    return (
      <Panel title="Loading..." onClose={onClose}>
        <div className="lace-panel-hint">Loading configuration...</div>
      </Panel>
    );
  }

  const dependsOnCount = localDependsOn.size;

  const title = (
    <div className="lace-mcp__title">
      <div className="lace-mcp__title-eyebrow">Module</div>
      <h3 className="lace-mcp__title-id">{instance_id}</h3>
    </div>
  );

  const footer = (
    <Button variant="primary" fullWidth onClick={handleSave}>
      Save configuration
    </Button>
  );

  return (
    <Panel title={title} footer={footer} scrollable={false} onClose={onClose}>
      {requiredInputs.length > 0 && (
        <AccordionSection title="Required Inputs" defaultOpen badge={`(${requiredInputs.length})`}>
          {requiredInputs.map(renderInputField)}
        </AccordionSection>
      )}

      {optionalInputs.length > 0 && (
        <AccordionSection title="Optional Inputs" defaultOpen badge={`(${optionalInputs.length})`}>
          {optionalInputs.map(renderInputField)}
        </AccordionSection>
      )}

      {config.sibling_ids.length > 0 && (
        <AccordionSection
          title="Depends On"
          badge={dependsOnCount > 0 ? `(${dependsOnCount})` : undefined}
        >
          <div className="lace-mcp__depends-hint">
            Select sibling instances this module depends on.
          </div>
          {config.sibling_ids.map((sibId) => {
            const depKey = `module.${sibId}`;
            return (
              <label key={sibId} className="lace-mcp__depends-item">
                <input
                  type="checkbox"
                  className="lace-mcp__depends-checkbox"
                  checked={localDependsOn.has(depKey)}
                  onChange={(e) => {
                    setLocalDependsOn((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(depKey);
                      else next.delete(depKey);
                      return next;
                    });
                  }}
                />
                <span className="lace-mcp__depends-label">{depKey}</span>
              </label>
            );
          })}
        </AccordionSection>
      )}

      {config.outputs.length > 0 && (
        <AccordionSection title="Outputs" badge={`(${config.outputs.length})`}>
          {config.outputs.map((o: RenderOutput) => (
            <div key={o.name} className="lace-mcp__output-card">
              <div className="lace-mcp__output-header">
                <strong className="lace-mcp__output-name">{o.name}</strong>
                <span className="lace-mcp__output-type">{o.type ?? ''}</span>
              </div>
              {o.description && <div className="lace-mcp__output-description">{o.description}</div>}
              {o.sensitive && <div className="lace-mcp__output-sensitive">sensitive</div>}
            </div>
          ))}
        </AccordionSection>
      )}
    </Panel>
  );
}
