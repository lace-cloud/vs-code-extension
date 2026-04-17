// src/webview/components/panels/TerraformConfigPanel.tsx
import { Input, Panel } from '@lace/ui';
import { useCallback, useState } from 'react';
import { useSaveState } from '../../hooks/useSaveState';
import type { SettingsConfig } from '../../types/render';
import SaveButton from '../SaveButton';
import './panels-shared.css';

// ── Types derived from SettingsConfig ──

type TerraformConfig = SettingsConfig['terraform'];

type ProviderRequirementRow = { name: string; source: string; version: string };

// ── Content-only component (used by UnifiedSettingsPanel) ──

type ContentProps = {
  terraform: TerraformConfig | undefined;
  readOnly?: boolean;
  onSave: (terraform: TerraformConfig) => void | Promise<void>;
};

export function TerraformConfigContent({ terraform, readOnly = false, onSave }: ContentProps) {
  const [requiredVersion, setRequiredVersion] = useState(terraform?.required_version ?? '');
  const [providers, setProviders] = useState<ProviderRequirementRow[]>(() => {
    if (!terraform?.required_providers) return [];
    return terraform.required_providers.map((req) => ({
      name: req.name,
      source: req.source ?? '',
      version: req.version ?? '',
    }));
  });

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

  const { status: saveStatus, handleSave } = useSaveState(
    useCallback(async () => {
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
      await onSave(block);
    }, [onSave, requiredVersion, providers]),
  );

  return (
    <>
      <h4 className="lace-panel-section-title">Required Version</h4>
      <div className="lace-panel-field">
        <Input
          value={requiredVersion}
          onChange={(e) => setRequiredVersion(e.target.value)}
          placeholder=">= 1.5"
          fullWidth
          readOnly={readOnly}
        />
      </div>

      <h4 className="lace-panel-section-title">Required Providers</h4>
      {providers.map((p, i) => (
        <div key={`provider-${i}`} className="lace-panel-row-card lace-panel-row-card--with-footer">
          <div className="lace-panel-row-actions">
            <Input
              value={p.name}
              onChange={(e) => updateProvider(i, 'name', e.target.value)}
              placeholder="Name (e.g. aws)"
              fullWidth
              readOnly={readOnly}
            />
            {!readOnly && (
              <button
                type="button"
                onClick={() => removeProvider(i)}
                className="lace-panel-remove-btn"
              >
                Remove
              </button>
            )}
          </div>
          <div className="lace-panel-row-actions">
            <Input
              value={p.source}
              onChange={(e) => updateProvider(i, 'source', e.target.value)}
              placeholder="Source (e.g. hashicorp/aws)"
              fullWidth
              readOnly={readOnly}
            />
          </div>
          <div className="lace-panel-row-actions">
            <Input
              value={p.version}
              onChange={(e) => updateProvider(i, 'version', e.target.value)}
              placeholder="Version (e.g. ~> 5.0)"
              fullWidth
              readOnly={readOnly}
            />
          </div>
        </div>
      ))}
      {!readOnly && (
        <button type="button" onClick={addProvider} className="lace-panel-add-btn">
          + Add provider
        </button>
      )}

      <h4 className="lace-panel-section-title">Backend</h4>
      <div className="lace-panel-hint">
        Terraform state is managed by Lace Cloud. The HTTP backend is configured automatically
        during generation.
      </div>

      {!readOnly && (
        <SaveButton status={saveStatus} label="Save configuration" onClick={handleSave} />
      )}
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
    <Panel title="Terraform Configuration" onClose={onClose}>
      <TerraformConfigContent terraform={terraform} onSave={onSave} />
    </Panel>
  );
}
