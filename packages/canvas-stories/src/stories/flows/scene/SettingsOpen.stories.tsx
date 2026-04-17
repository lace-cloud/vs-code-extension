import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';
import { populatedSettings } from '../../../mocks/fixtures/configs';

// Scene — canvas with the UnifiedSettingsPanel slide-in visible.
// Opens via the gear icon in ActionBar; the scene clicks it after
// mount. Terraform Config is open by default; the accordion chrome
// is the other three (Providers, Locals, Environments) collapsed.

const meta: Meta = {
  title: 'Flows/Scene/SettingsOpen',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <MockFlowDecorator
      fixture={iamStackFixture}
      engineOptions={{ settings: populatedSettings }}
      onReady={() => {
        // ActionBar's gear icon is the only way into Settings. Query
        // by aria-label so the click target survives DOM shuffles.
        requestAnimationFrame(() => {
          const btn = document.querySelector<HTMLButtonElement>('[aria-label="Settings"]');
          btn?.click();
        });
      }}
    />
  ),
};
