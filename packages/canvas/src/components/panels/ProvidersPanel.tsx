// src/webview/components/panels/ProvidersPanel.tsx
import { Input, Panel } from '@lace/ui';
import { useCallback, useState } from 'react';
import { useSaveState } from '../../hooks/useSaveState';
import type { SettingsConfig } from '../../types/render';
import SaveButton from '../SaveButton';
import './panels-shared.css';

// ── Types derived from SettingsConfig ──

type ProviderEntry = SettingsConfig['providers'][number];

// ── Local editing state ──

type ProviderRow = {
  name: string;
  alias: string;
  configEntries: Array<{ key: string; value: string }>;
};

function toRows(providers: ProviderEntry[] | undefined): ProviderRow[] {
  if (!providers || providers.length === 0) return [];
  return providers.map((p) => ({
    name: p.name,
    alias: p.alias ?? '',
    configEntries: Object.entries(p.config).map(([key, value]) => ({
      key,
      value: String(value),
    })),
  }));
}

function fromRows(rows: ProviderRow[]): ProviderEntry[] {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => {
      const config: Record<string, unknown> = {};
      for (const c of r.configEntries) {
        if (c.key.trim()) {
          config[c.key.trim()] = c.value;
        }
      }
      return {
        name: r.name.trim(),
        alias: r.alias.trim() || '',
        config,
      };
    });
}

// ── Content-only component (used by UnifiedSettingsPanel) ──

type ContentProps = {
  providers: ProviderEntry[] | undefined;
  readOnly?: boolean;
  onSave: (providers: ProviderEntry[]) => void | Promise<void>;
};

export function ProvidersContent({ providers, readOnly = false, onSave }: ContentProps) {
  const [rows, setRows] = useState<ProviderRow[]>(() => toRows(providers));

  const addProvider = useCallback(() => {
    setRows((prev) => [...prev, { name: '', alias: '', configEntries: [{ key: '', value: '' }] }]);
  }, []);

  const removeProvider = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateField = useCallback((index: number, field: 'name' | 'alias', value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }, []);

  const addConfigEntry = useCallback((providerIndex: number) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === providerIndex
          ? { ...r, configEntries: [...r.configEntries, { key: '', value: '' }] }
          : r,
      ),
    );
  }, []);

  const removeConfigEntry = useCallback((providerIndex: number, entryIndex: number) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === providerIndex
          ? { ...r, configEntries: r.configEntries.filter((_, ei) => ei !== entryIndex) }
          : r,
      ),
    );
  }, []);

  const updateConfigEntry = useCallback(
    (providerIndex: number, entryIndex: number, field: 'key' | 'value', value: string) => {
      setRows((prev) =>
        prev.map((r, i) =>
          i === providerIndex
            ? {
                ...r,
                configEntries: r.configEntries.map((c, ei) =>
                  ei === entryIndex ? { ...c, [field]: value } : c,
                ),
              }
            : r,
        ),
      );
    },
    [],
  );

  const { status: saveStatus, handleSave } = useSaveState(
    useCallback(async () => {
      await onSave(fromRows(rows));
    }, [onSave, rows]),
  );

  return (
    <>
      {rows.map((row, pi) => (
        <div
          key={`provider-${pi}`}
          className="lace-panel-row-card lace-panel-row-card--with-footer"
        >
          <div className="lace-panel-row-actions">
            <Input
              value={row.name}
              onChange={(e) => updateField(pi, 'name', e.target.value)}
              placeholder="Provider name (e.g. aws)"
              fullWidth
              readOnly={readOnly}
            />
            <Input
              value={row.alias}
              onChange={(e) => updateField(pi, 'alias', e.target.value)}
              placeholder="Alias (optional)"
              fullWidth
              readOnly={readOnly}
            />
            {!readOnly && (
              <button
                type="button"
                onClick={() => removeProvider(pi)}
                className="lace-panel-remove-btn"
                aria-label="Remove provider"
              >
                ✕
              </button>
            )}
          </div>

          <div className="lace-panel-row-sublabel">Config</div>
          {row.configEntries.map((entry, ei) => (
            <div key={`config-${pi}-${ei}`} className="lace-panel-row-actions">
              <Input
                value={entry.key}
                onChange={(e) => updateConfigEntry(pi, ei, 'key', e.target.value)}
                placeholder="Key"
                fullWidth
                readOnly={readOnly}
              />
              <Input
                value={entry.value}
                onChange={(e) => updateConfigEntry(pi, ei, 'value', e.target.value)}
                placeholder="Value"
                fullWidth
                readOnly={readOnly}
              />
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => removeConfigEntry(pi, ei)}
                  className="lace-panel-remove-btn lace-panel-remove-btn--sm"
                  aria-label="Remove config key"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button
              type="button"
              onClick={() => addConfigEntry(pi)}
              className="lace-panel-add-btn lace-panel-add-btn--sm"
            >
              + Add config key
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        <>
          <button type="button" onClick={addProvider} className="lace-panel-add-btn">
            + Add provider
          </button>

          <SaveButton status={saveStatus} label="Save providers" onClick={handleSave} />
        </>
      )}
    </>
  );
}

// ── Full panel (backwards compat — original default export) ──

type Props = {
  providers: ProviderEntry[] | undefined;
  onSave: (providers: ProviderEntry[]) => void | Promise<void>;
  onClose: () => void;
};

export default function ProvidersPanel({ providers, onSave, onClose }: Props) {
  return (
    <Panel title="Providers" onClose={onClose}>
      <ProvidersContent providers={providers} onSave={onSave} />
    </Panel>
  );
}
