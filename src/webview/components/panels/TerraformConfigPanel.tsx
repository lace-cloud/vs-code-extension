// src/webview/components/panels/TerraformConfigPanel.tsx
import React, { useState, useCallback } from 'react';
import type { SettingsConfig } from '../../types/render';
import {
  inputClasses,
  BACKEND_TYPES,
  saveButtonClasses,
  removeButtonClasses,
  addButtonClasses,
} from '../../styles/panel';
import { parseConfigValue } from '../../utils/parseValue';
import PanelFrame from '../PanelFrame';

// ── Types derived from SettingsConfig ──

type TerraformConfig = SettingsConfig['terraform'];

type ProviderRequirementRow = { name: string; source: string; version: string };

// ── Content-only component (used by UnifiedSettingsPanel) ──

type ContentProps = {
  terraform: TerraformConfig | undefined;
  onSave: (terraform: TerraformConfig) => void;
};

export function TerraformConfigContent({ terraform, onSave }: ContentProps) {
  const [requiredVersion, setRequiredVersion] = useState(terraform?.required_version ?? '');
  const [providers, setProviders] = useState<ProviderRequirementRow[]>(() => {
    if (!terraform?.required_providers) return [];
    return terraform.required_providers.map((req) => ({
      name: req.name,
      source: req.source ?? '',
      version: req.version ?? '',
    }));
  });

  const [backendType, setBackendType] = useState(terraform?.backend?.type ?? 's3');
  const [backendConfig, setBackendConfig] = useState<Array<{ key: string; value: string }>>(() => {
    if (!terraform?.backend?.config) return [];
    return Object.entries(terraform.backend.config).map(([key, value]) => ({
      key,
      value: typeof value === 'boolean' ? String(value) : String(value),
    }));
  });

  // ── Provider rows ──

  const addProvider = useCallback(() => {
    setProviders((prev) => [...prev, { name: '', source: '', version: '' }]);
  }, []);

  const removeProvider = useCallback((index: number) => {
    setProviders((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateProvider = useCallback(
    (index: number, field: 'name' | 'source' | 'version', value: string) => {
      setProviders((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
    },
    [],
  );

  // ── Backend config rows ──

  const addBackendKey = useCallback(() => {
    setBackendConfig((prev) => [...prev, { key: '', value: '' }]);
  }, []);

  const removeBackendKey = useCallback((index: number) => {
    setBackendConfig((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateBackendKey = useCallback((index: number, field: 'key' | 'value', value: string) => {
    setBackendConfig((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }, []);

  // ── Save ──

  const handleSave = () => {
    const block: TerraformConfig = {
      required_version: requiredVersion.trim() || '',
      required_providers: providers
        .filter((p) => p.name.trim())
        .map((p) => ({
          name: p.name.trim(),
          source: p.source.trim(),
          version: p.version.trim(),
        })),
    };

    if (backendConfig.length > 0) {
      const config: Record<string, unknown> = {};
      for (const c of backendConfig) {
        if (c.key.trim()) {
          config[c.key.trim()] = parseConfigValue(c.value);
        }
      }
      block.backend = { type: backendType, config };
    }

    onSave(block);
  };

  return (
    <>
      {/* Required Version */}
      <SectionTitle label="Required Version" />
      <input
        value={requiredVersion}
        onChange={(e) => setRequiredVersion(e.target.value)}
        placeholder=">= 1.5"
        className={`${inputClasses} mb-4`}
      />

      {/* Required Providers */}
      <SectionTitle label="Required Providers" />
      {providers.map((p, i) => (
        <div key={i} className="mb-3 p-2.5 bg-[#0f0f0f] border border-[#333] rounded-lg">
          <div className="flex gap-2 mb-2">
            <input
              value={p.name}
              onChange={(e) => updateProvider(i, 'name', e.target.value)}
              placeholder="Name (e.g. aws)"
              className={`${inputClasses} flex-1`}
            />
            <button onClick={() => removeProvider(i)} className={removeButtonClasses}>
              Remove
            </button>
          </div>
          <input
            value={p.source}
            onChange={(e) => updateProvider(i, 'source', e.target.value)}
            placeholder="Source (e.g. hashicorp/aws)"
            className={`${inputClasses} mb-2`}
          />
          <input
            value={p.version}
            onChange={(e) => updateProvider(i, 'version', e.target.value)}
            placeholder="Version (e.g. ~> 5.0)"
            className={inputClasses}
          />
        </div>
      ))}
      <button onClick={addProvider} className={addButtonClasses}>
        + Add provider
      </button>

      {/* Backend */}
      <SectionTitle label="Backend" />
      <select
        value={backendType}
        onChange={(e) => setBackendType(e.target.value)}
        className={`${inputClasses} mb-3`}
      >
        {BACKEND_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {backendConfig.map((c, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <input
            value={c.key}
            onChange={(e) => updateBackendKey(i, 'key', e.target.value)}
            placeholder="Key"
            className={`${inputClasses} flex-1`}
          />
          <input
            value={c.value}
            onChange={(e) => updateBackendKey(i, 'value', e.target.value)}
            placeholder="Value"
            className={`${inputClasses} flex-1`}
          />
          <button onClick={() => removeBackendKey(i)} className={removeButtonClasses}>
            ✕
          </button>
        </div>
      ))}
      <button onClick={addBackendKey} className={addButtonClasses}>
        + Add config key
      </button>

      {/* Inline save */}
      <button className={saveButtonClasses} onClick={handleSave}>
        Save configuration
      </button>
    </>
  );
}

// ── Full panel (backwards compat — original default export) ──

type Props = {
  terraform: TerraformConfig | undefined;
  onSave: (terraform: TerraformConfig) => void;
  onClose: () => void;
};

export default function TerraformConfigPanel({ terraform, onSave, onClose }: Props) {
  return (
    <PanelFrame title="Terraform Configuration" onClose={onClose}>
      <TerraformConfigContent terraform={terraform} onSave={onSave} />
    </PanelFrame>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <h4 className="m-0 mb-3 text-[13px] font-bold uppercase tracking-wide opacity-85">{label}</h4>
  );
}
