// src/webview/components/panels/ProvidersPanel.tsx
import React, { useState, useCallback } from 'react';
import type { ProviderConfig } from '../../types/ir';
import {
  inputClasses,
  saveButtonClasses,
  removeButtonClasses,
  removeButtonSmClasses,
  addButtonClasses,
  addButtonSmClasses,
  rowCardClasses,
} from '../../styles/panel';
import PanelFrame from '../PanelFrame';

// ── Local editing state ──

type ProviderRow = {
  name: string;
  alias: string;
  configEntries: Array<{ key: string; value: string }>;
};

function toRows(providers: ProviderConfig[] | undefined): ProviderRow[] {
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

function fromRows(rows: ProviderRow[]): ProviderConfig[] {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => {
      const config: Record<string, any> = {};
      for (const c of r.configEntries) {
        if (c.key.trim()) {
          config[c.key.trim()] = c.value;
        }
      }
      return {
        name: r.name.trim(),
        ...(r.alias.trim() ? { alias: r.alias.trim() } : {}),
        config,
      };
    });
}

// ── Content-only component (used by UnifiedSettingsPanel) ──

type ContentProps = {
  providers: ProviderConfig[] | undefined;
  onSave: (providers: ProviderConfig[]) => void;
};

export function ProvidersContent({ providers, onSave }: ContentProps) {
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

  const handleSave = () => {
    onSave(fromRows(rows));
  };

  return (
    <>
      {rows.map((row, pi) => (
        <div key={pi} className={rowCardClasses}>
          <div className="flex gap-2 mb-2">
            <input
              value={row.name}
              onChange={(e) => updateField(pi, 'name', e.target.value)}
              placeholder="Provider name (e.g. aws)"
              className={`${inputClasses} flex-1`}
            />
            <input
              value={row.alias}
              onChange={(e) => updateField(pi, 'alias', e.target.value)}
              placeholder="Alias (optional)"
              className={`${inputClasses} flex-1`}
            />
            <button onClick={() => removeProvider(pi)} className={removeButtonClasses}>
              ✕
            </button>
          </div>

          <div className="text-[11px] opacity-70 mb-2">Config</div>
          {row.configEntries.map((entry, ei) => (
            <div key={ei} className="flex gap-2 mb-1.5">
              <input
                value={entry.key}
                onChange={(e) => updateConfigEntry(pi, ei, 'key', e.target.value)}
                placeholder="Key"
                className={`${inputClasses} flex-1`}
              />
              <input
                value={entry.value}
                onChange={(e) => updateConfigEntry(pi, ei, 'value', e.target.value)}
                placeholder="Value"
                className={`${inputClasses} flex-1`}
              />
              <button onClick={() => removeConfigEntry(pi, ei)} className={removeButtonSmClasses}>
                ✕
              </button>
            </div>
          ))}
          <button onClick={() => addConfigEntry(pi)} className={addButtonSmClasses}>
            + Add config key
          </button>
        </div>
      ))}

      <button onClick={addProvider} className={addButtonClasses}>
        + Add provider
      </button>

      {/* Inline save */}
      <button className={saveButtonClasses} onClick={handleSave}>
        Save providers
      </button>
    </>
  );
}

// ── Full panel (backwards compat — original default export) ──

type Props = {
  providers: ProviderConfig[] | undefined;
  onSave: (providers: ProviderConfig[]) => void;
  onClose: () => void;
};

export default function ProvidersPanel({ providers, onSave, onClose }: Props) {
  return (
    <PanelFrame title="Providers" onClose={onClose}>
      <ProvidersContent providers={providers} onSave={onSave} />
    </PanelFrame>
  );
}
