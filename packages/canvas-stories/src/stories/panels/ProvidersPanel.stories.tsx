import { default as ProvidersPanel } from '@lace/canvas/components/panels/ProvidersPanel';
import type { Meta, StoryObj } from '@storybook/react';
import { populatedSettings } from '../../mocks/fixtures/configs';

// ProvidersPanel edits `provider {}` blocks: each row is name + alias
// + a nested list of config key/value pairs. Two levels of add/remove
// (providers + config entries per provider).

const meta: Meta<typeof ProvidersPanel> = {
  title: 'Panels/ProvidersPanel',
  component: ProvidersPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Edits `provider {}` blocks. Each row has name + alias (for multi-region setups) + nested key/value config entries. Two nested add/remove levels; the nested rows use the `--sm` button variants to signal sub-depth.',
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

type Story = StoryObj<typeof ProvidersPanel>;

// Empty — common first-time state.
export const Empty: Story = {
  args: { providers: [] },
};

// Populated — two aws provider instances (one default, one aliased
// "east"). Covers both alias display and multi-config-entry rendering.
export const Populated: Story = {
  args: { providers: populatedSettings.providers },
};
