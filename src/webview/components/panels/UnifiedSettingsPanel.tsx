// src/webview/components/panels/UnifiedSettingsPanel.tsx
import React from 'react';
import type { TerraformBlock, ProviderConfig, LocalDef, BackendConfig } from '../../types/ir';
import AccordionSection from '../AccordionSection';
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
    <div className="w-[420px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col">
      {/* Header */}
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        <h3 className="m-0 text-base">Settings</h3>
        <button
          onClick={onClose}
          className="cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-lg w-[34px] h-[34px]"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      {/* Scrollable body with accordion sections */}
      <div className="flex-1 overflow-y-auto">
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
      </div>
    </div>
  );
}
