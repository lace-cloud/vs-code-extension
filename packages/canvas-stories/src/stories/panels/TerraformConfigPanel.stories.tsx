import {
  TerraformConfigContent,
  default as TerraformConfigPanel,
} from '@lace/canvas/components/panels/TerraformConfigPanel';
import { Panel } from '@lace/ui';
import type { Meta, StoryObj } from '@storybook/react';
import { populatedSettings } from '../../mocks/fixtures/configs';

// TerraformConfigPanel exposes both the full panel (with Panel chrome)
// and the content-only component used inside UnifiedSettingsPanel.
// Stories cover the content shape; the panel wrapper's chrome is
// covered by UI/Panel stories and the SettingsOpen scene.

const meta: Meta<typeof TerraformConfigPanel> = {
  title: 'Panels/TerraformConfigPanel',
  component: TerraformConfigPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Edits the `terraform {}` block: required_version and required_providers. Backend is managed by Lace Cloud and not editable. Shown from the settings sidebar as the first accordion; the full-panel variant opens when users navigate to just this config.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          width: 480,
          height: '100vh',
          background: 'var(--lace-color-bg-canvas)',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    onSave: async () => {},
    onClose: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof TerraformConfigPanel>;

// Empty — fresh project with no constraints pinned. Users land here
// on first settings open if they haven't configured providers yet.
export const Empty: Story = {
  args: { terraform: { required_version: '', required_providers: [] } },
};

// Populated — a typical dev setup: version pin + aws + random
// providers. Shown in the SettingsOpen scene as the default expanded
// section.
export const Populated: Story = {
  args: { terraform: populatedSettings.terraform },
};

// Content-only (as embedded in UnifiedSettingsPanel). Proves the
// component renders without the Panel wrapper — important because
// UnifiedSettingsPanel embeds the *Content* variant inside an
// AccordionSection, not the full panel.
export const AsAccordionContent: Story = {
  name: 'As accordion content (no Panel wrapper)',
  render: () => (
    <Panel title="Settings" onClose={() => {}} scrollable={false}>
      <div style={{ padding: 16 }}>
        <TerraformConfigContent terraform={populatedSettings.terraform} onSave={async () => {}} />
      </div>
    </Panel>
  ),
};
