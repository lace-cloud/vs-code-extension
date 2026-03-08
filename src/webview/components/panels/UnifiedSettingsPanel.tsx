// src/webview/components/panels/UnifiedSettingsPanel.tsx
import React, { useState, useEffect } from 'react';
import type { SettingsConfig } from '../../types/render';
import type { CanvasEngine } from '../../engine';
import AccordionSection from '../AccordionSection';
import PanelFrame from '../PanelFrame';
import { TerraformConfigContent } from './TerraformConfigPanel';
import { ProvidersContent } from './ProvidersPanel';
import { LocalsContent } from './LocalsPanel';
import { EnvironmentsContent } from './EnvironmentsPanel';

type Props = {
  engine: CanvasEngine;
  onClose: () => void;
};

export default function UnifiedSettingsPanel({ engine, onClose }: Props) {
  const [settings, setSettings] = useState<SettingsConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch settings from engine
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    engine.querySettings().then((result) => {
      if (cancelled) return;
      setSettings(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [engine]);

  if (loading || !settings) {
    return (
      <PanelFrame title="Settings" scrollable={false} onClose={onClose}>
        <div className="text-xs opacity-60">Loading settings...</div>
      </PanelFrame>
    );
  }

  return (
    <PanelFrame title="Settings" scrollable={false} onClose={onClose}>
      <AccordionSection title="Terraform Config" defaultOpen>
        <TerraformConfigContent
          terraform={settings.terraform}
          onSave={async (terraform) => {
            await engine.setTerraform(
              terraform.required_version,
              terraform.required_providers.length > 0
                ? terraform.required_providers.map((p) => ({
                    name: p.name,
                    source: p.source,
                    version: p.version,
                  }))
                : undefined,
              terraform.backend,
            );
          }}
        />
      </AccordionSection>

      <AccordionSection title="Providers">
        <ProvidersContent
          providers={settings.providers}
          onSave={async (providers) => {
            await engine.setProviders(
              providers.map((p) => ({
                name: p.name,
                alias: p.alias,
                config: p.config,
              })),
            );
          }}
        />
      </AccordionSection>

      <AccordionSection title="Locals">
        <LocalsContent
          locals={settings.locals}
          onSave={async (locals) => {
            await engine.setLocals(
              locals.map((l) => {
                if (l.mode === 'expression') {
                  return { name: l.name, mode: l.mode, expression: l.value_display };
                }
                // Literal mode: try parsing as JSON for structured values
                let value: unknown = l.value_display;
                try {
                  value = JSON.parse(l.value_display);
                } catch {
                  /* keep as string */
                }
                return { name: l.name, mode: l.mode, value };
              }),
            );
          }}
        />
      </AccordionSection>

      <AccordionSection title="Environments">
        <EnvironmentsContent
          environments={settings.environments}
          environment_backends={settings.environment_backends}
          onSave={async (environments, backends) => {
            await engine.setEnvironments(environments, backends);
          }}
        />
      </AccordionSection>
    </PanelFrame>
  );
}
