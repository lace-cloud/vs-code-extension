// src/webview/components/panels/LocalsPanel.tsx
import { Input, ModeToggle, Panel, Textarea } from '@lace/ui';
import { useCallback, useState } from 'react';
import { useSaveState } from '../../hooks/useSaveState';
import type { SettingsConfig } from '../../types/render';
import { findDuplicateIndices } from '../../utils/duplicates';
import SaveButton from '../SaveButton';
import './panels-shared.css';

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

const BINDING_MODE_ITEMS = [
  { value: 'literal' as const, label: 'Literal' },
  { value: 'expression' as const, label: 'Expression' },
];

// ── Content-only component (used by UnifiedSettingsPanel) ──

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

  const nameDupes = findDuplicateIndices(rows, (r) => r.name);
  const hasErrors = nameDupes.size > 0;

  const { status: saveStatus, handleSave } = useSaveState(
    useCallback(async () => {
      if (hasErrors) return;
      await onSave(fromRows(rows));
    }, [onSave, rows, hasErrors]),
  );

  return (
    <>
      {rows.map((row, i) => (
        <div key={`local-${i}`} className="lace-panel-row-card lace-panel-row-card--with-footer">
          <div className="lace-panel-row-actions">
            <Input
              value={row.name}
              onChange={(e) => updateName(i, e.target.value)}
              placeholder="Local name"
              fullWidth
              mono
              error={nameDupes.has(i)}
            />
            <button
              type="button"
              onClick={() => removeLocal(i)}
              className="lace-panel-remove-btn"
              aria-label="Remove local"
            >
              ✕
            </button>
          </div>
          {nameDupes.has(i) && <div className="lace-panel-row-error">Duplicate local name</div>}

          <div className="lace-panel-row-actions">
            <ModeToggle<BindingMode>
              value={row.mode}
              onChange={(next) => switchMode(i, next)}
              items={BINDING_MODE_ITEMS}
              aria-label="Local binding mode"
            />
          </div>

          <div className="lace-panel-row-content">
            {row.mode === 'literal' ? (
              <Textarea
                value={row.litValue}
                onChange={(e) => updateLitValue(i, e.target.value)}
                placeholder='e.g. "my-bucket" or {"key": "value"}'
                rows={3}
                fullWidth
                mono
              />
            ) : (
              <Textarea
                value={row.exprValue}
                onChange={(e) => updateExprValue(i, e.target.value)}
                placeholder='e.g. "${var.environment}-${var.role_name}"'
                rows={3}
                fullWidth
                mono
              />
            )}
          </div>
        </div>
      ))}

      <button type="button" onClick={addLocal} className="lace-panel-add-btn">
        + Add local
      </button>

      <SaveButton
        status={saveStatus}
        label="Save locals"
        onClick={handleSave}
        disabled={hasErrors}
        disabledTitle="Fix errors before saving"
      />
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
    <Panel title="Locals" onClose={onClose}>
      <LocalsContent locals={locals} onSave={onSave} />
    </Panel>
  );
}
