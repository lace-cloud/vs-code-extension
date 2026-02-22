// src/webview/components/panels/ProvidersPanel.tsx
import React, { useState, useCallback } from 'react';
import type { ProviderConfig } from '../../types/ir';

// ── Props ──

type Props = {
  providers: ProviderConfig[] | undefined;
  onSave: (providers: ProviderConfig[]) => void;
  onClose: () => void;
};

// ── Shared styles ──

const inputClasses =
  'w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs';

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

// ── Component ──

export default function ProvidersPanel({ providers, onSave, onClose }: Props) {
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
    <div className="absolute right-0 top-0 w-[420px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col z-20">
      {/* Header */}
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        <h3 className="m-0 text-base">Providers</h3>
        <button
          onClick={onClose}
          className="cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-lg w-[34px] h-[34px]"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {rows.map((row, pi) => (
          <div key={pi} className="mb-4 p-3 bg-[#0f0f0f] border border-[#333] rounded-lg">
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
              <button
                onClick={() => removeProvider(pi)}
                className="text-[#e5484d] text-xs px-2 cursor-pointer bg-transparent border-none"
              >
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
                <button
                  onClick={() => removeConfigEntry(pi, ei)}
                  className="text-[#e5484d] text-[10px] px-1.5 cursor-pointer bg-transparent border-none"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => addConfigEntry(pi)}
              className="text-[10px] text-[#1f6feb] cursor-pointer bg-transparent border-none mt-1"
            >
              + Add config key
            </button>
          </div>
        ))}

        <button
          onClick={addProvider}
          className="text-xs text-[#1f6feb] cursor-pointer bg-transparent border-none"
        >
          + Add provider
        </button>
      </div>

      {/* Footer */}
      <footer className="p-4 border-t border-[#333] bg-[#1e1e1e] sticky bottom-0 z-30">
        <button
          className="w-full py-3 bg-[#1f6feb] text-white border-none rounded-[10px] font-bold text-sm cursor-pointer"
          onClick={handleSave}
        >
          Save providers
        </button>
      </footer>
    </div>
  );
}
