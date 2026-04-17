// src/webview/components/panels/EnvironmentsPanel.tsx
import { Input, Panel } from '@lace/ui';
import { useCallback, useState } from 'react';
import { useSaveState } from '../../hooks/useSaveState';
import { findDuplicateIndices } from '../../utils/duplicates';
import SaveButton from '../SaveButton';
import './panels-shared.css';

// ── Local editing state ──

type EnvVarEntry = { key: string; value: string };
type EnvRow = { name: string; vars: EnvVarEntry[] };

function toEnvRows(envs: Record<string, Record<string, unknown>> | undefined): EnvRow[] {
  if (!envs) return [];
  return Object.entries(envs).map(([name, vars]) => ({
    name,
    vars: Object.entries(vars).map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    })),
  }));
}

function fromEnvRows(rows: EnvRow[]): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const vars: Record<string, unknown> = {};
    for (const v of row.vars) {
      if (!v.key.trim()) continue;
      try {
        vars[v.key.trim()] = JSON.parse(v.value);
      } catch {
        vars[v.key.trim()] = v.value;
      }
    }
    result[row.name.trim()] = vars;
  }
  return result;
}

// ── Content-only component (used by UnifiedSettingsPanel) ──

type ContentProps = {
  environments: Record<string, Record<string, unknown>> | undefined;
  onSave: (environments: Record<string, Record<string, unknown>>) => void | Promise<void>;
};

export function EnvironmentsContent({ environments, onSave }: ContentProps) {
  const [envRows, setEnvRows] = useState<EnvRow[]>(() => toEnvRows(environments));

  const addEnv = useCallback(() => {
    setEnvRows((prev) => [...prev, { name: '', vars: [{ key: '', value: '' }] }]);
  }, []);

  const removeEnv = useCallback((index: number) => {
    setEnvRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateEnvName = useCallback((index: number, name: string) => {
    setEnvRows((prev) => prev.map((r, i) => (i === index ? { ...r, name } : r)));
  }, []);

  const addEnvVar = useCallback((envIndex: number) => {
    setEnvRows((prev) =>
      prev.map((r, i) =>
        i === envIndex ? { ...r, vars: [...r.vars, { key: '', value: '' }] } : r,
      ),
    );
  }, []);

  const removeEnvVar = useCallback((envIndex: number, varIndex: number) => {
    setEnvRows((prev) =>
      prev.map((r, i) =>
        i === envIndex ? { ...r, vars: r.vars.filter((_, vi) => vi !== varIndex) } : r,
      ),
    );
  }, []);

  const updateEnvVar = useCallback(
    (envIndex: number, varIndex: number, field: 'key' | 'value', value: string) => {
      setEnvRows((prev) =>
        prev.map((r, i) =>
          i === envIndex
            ? {
                ...r,
                vars: r.vars.map((v, vi) => (vi === varIndex ? { ...v, [field]: value } : v)),
              }
            : r,
        ),
      );
    },
    [],
  );

  const envNameDupes = findDuplicateIndices(envRows, (r) => r.name);

  const envVarDupes: Record<number, Set<number>> = {};
  envRows.forEach((env, ei) => {
    const dupes = findDuplicateIndices(env.vars, (v) => v.key);
    if (dupes.size > 0) envVarDupes[ei] = dupes;
  });

  const hasDuplicates = envNameDupes.size > 0 || Object.keys(envVarDupes).length > 0;

  const { status: saveStatus, handleSave } = useSaveState(
    useCallback(async () => {
      if (hasDuplicates) return;
      await onSave(fromEnvRows(envRows));
    }, [onSave, envRows, hasDuplicates]),
  );

  return (
    <>
      {envRows.map((env, ei) => (
        <div key={`env-${ei}`} className="lace-panel-row-card lace-panel-row-card--with-footer">
          <div className="lace-panel-row-actions">
            <Input
              value={env.name}
              onChange={(e) => updateEnvName(ei, e.target.value)}
              placeholder="Environment name (e.g. dev)"
              fullWidth
              error={envNameDupes.has(ei)}
            />
            <button
              type="button"
              onClick={() => removeEnv(ei)}
              className="lace-panel-remove-btn"
              aria-label="Remove environment"
            >
              ✕
            </button>
          </div>
          {envNameDupes.has(ei) && (
            <div className="lace-panel-row-error">Duplicate environment name</div>
          )}

          <div className="lace-panel-row-sublabel">Variable overrides</div>
          {env.vars.map((v, vi) => (
            <div key={`envvar-${ei}-${vi}`} className="lace-panel-row-actions">
              <Input
                value={v.key}
                onChange={(e) => updateEnvVar(ei, vi, 'key', e.target.value)}
                placeholder="Variable name"
                fullWidth
                error={envVarDupes[ei]?.has(vi)}
                title={envVarDupes[ei]?.has(vi) ? 'Duplicate variable name' : undefined}
              />
              <Input
                value={v.value}
                onChange={(e) => updateEnvVar(ei, vi, 'value', e.target.value)}
                placeholder="Value"
                fullWidth
              />
              <button
                type="button"
                onClick={() => removeEnvVar(ei, vi)}
                className="lace-panel-remove-btn lace-panel-remove-btn--sm"
                aria-label="Remove variable"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addEnvVar(ei)}
            className="lace-panel-add-btn lace-panel-add-btn--sm"
          >
            + Add variable
          </button>
        </div>
      ))}
      <button type="button" onClick={addEnv} className="lace-panel-add-btn">
        + Add environment
      </button>

      <SaveButton
        status={saveStatus}
        label="Save environments"
        onClick={handleSave}
        disabled={hasDuplicates}
        disabledTitle="Fix duplicate names before saving"
      />
      {hasDuplicates && (
        <div className="lace-panel-row-error">
          Fix duplicate environment or variable names before saving.
        </div>
      )}
    </>
  );
}

// ── Full panel (backwards compat — original default export) ──

type Props = {
  environments: Record<string, Record<string, unknown>> | undefined;
  onSave: (environments: Record<string, Record<string, unknown>>) => void | Promise<void>;
  onClose: () => void;
};

export default function EnvironmentsPanel({ environments, onSave, onClose }: Props) {
  return (
    <Panel title="Environments" onClose={onClose}>
      <EnvironmentsContent environments={environments} onSave={onSave} />
    </Panel>
  );
}
