// src/webview/components/panels/UnifiedSettingsPanel.tsx
import React from 'react';
import type { TerraformBlock, ProviderConfig, LocalDef, BackendConfig } from '../../types/ir';
import AccordionSection from '../AccordionSection';
import PanelFrame from '../PanelFrame';
import { TerraformConfigContent } from './TerraformConfigPanel';
import { ProvidersContent } from './ProvidersPanel';
import { LocalsContent } from './LocalsPanel';
import { EnvironmentsContent } from './EnvironmentsPanel';

type Props = {
  terraform: TerraformBlock | undefined;
  providers: ProviderConfig[] | undefined;
  locals: LocalDef[] | undefined;
  environments: Record<string, Record<string, any>> | undefined;
  environment_backends: Record<string, BackendConfig> | undefined;
  onSaveTerraform: (terraform: TerraformBlock) => void;
  onSaveProviders: (providers: ProviderConfig[]) => void;
  onSaveLocals: (locals: LocalDef[]) => void;
  onSaveEnvironments: (
    environments: Record<string, Record<string, any>>,
    backends: Record<string, BackendConfig>,
  ) => void;
  onClose: () => void;
};

export default function UnifiedSettingsPanel({
  terraform,
  providers,
  locals,
  environments,
  environment_backends,
  onSaveTerraform,
  onSaveProviders,
  onSaveLocals,
  onSaveEnvironments,
  onClose,
}: Props) {
  return (
    <PanelFrame title="Settings" scrollable={false} onClose={onClose}>
      <AccordionSection title="Terraform Config" defaultOpen>
        <TerraformConfigContent terraform={terraform} onSave={onSaveTerraform} />
      </AccordionSection>

      <AccordionSection title="Providers">
        <ProvidersContent providers={providers} onSave={onSaveProviders} />
      </AccordionSection>

      <AccordionSection title="Locals">
        <LocalsContent locals={locals} onSave={onSaveLocals} />
      </AccordionSection>

      <AccordionSection title="Environments">
        <EnvironmentsContent
          environments={environments}
          environment_backends={environment_backends}
          onSave={onSaveEnvironments}
        />
      </AccordionSection>
    </PanelFrame>
  );
}
