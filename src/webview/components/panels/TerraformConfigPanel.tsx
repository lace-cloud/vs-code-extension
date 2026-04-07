// src/webview/components/panels/TerraformConfigPanel.tsx
import React, { useState, useCallback } from 'react';
import type { SettingsConfig } from '../../types/render';
import {
  inputClasses,
  saveButtonClasses,
  saveButtonSavingClasses,
  saveButtonSuccessClasses,
  saveButtonErrorClasses,
  removeButtonClasses,
  addButtonClasses,
} from '../../styles/panel';
import PanelFrame from '../PanelFrame';

// ── Types derived from SettingsConfig ──

type TerraformConfig = SettingsConfig['terraform'];

type ProviderRequirementRow = { name: string; source: string; version: string };

// ── Content-only component (used by UnifiedSettingsPanel) ──

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type ContentProps = {
  terraform: TerraformConfig | undefined;
  onSave: (terraform: TerraformConfig) => void | Promise<void>;
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

  // ── Save ──

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const handleSave = async () => {
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

    setSaveStatus('saving');
    try {
      await onSave(block);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
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

      {/* Backend — managed by Lace */}
      <SectionTitle label="Backend" />
      <div className="text-xs opacity-60 mb-4">
        Terraform state is managed by Lace Cloud. The HTTP backend is configured automatically
        during generation.
      </div>

      {/* Inline save */}
      <button
        className={
          saveStatus === 'saving'
            ? saveButtonSavingClasses
            : saveStatus === 'saved'
              ? saveButtonSuccessClasses
              : saveStatus === 'error'
                ? saveButtonErrorClasses
                : saveButtonClasses
        }
        onClick={handleSave}
        disabled={saveStatus === 'saving'}
      >
        {saveStatus === 'saving'
          ? 'Saving...'
          : saveStatus === 'saved'
            ? 'Saved!'
            : saveStatus === 'error'
              ? 'Save failed — try again'
              : 'Save configuration'}
      </button>
    </>
  );
}

// ── Full panel (backwards compat — original default export) ──

type Props = {
  terraform: TerraformConfig | undefined;
  onSave: (terraform: TerraformConfig) => void | Promise<void>;
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
