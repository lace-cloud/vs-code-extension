import { EnvironmentsPanel } from '@lace/canvas';
import type { Meta, StoryObj } from '@storybook/react';
import { populatedSettings } from '../../mocks/fixtures/configs';

// EnvironmentsPanel is the most interaction-rich settings panel: it
// edits a two-level structure (env name → variable overrides).
// Duplicates at either level flag red and block save.

const meta: Meta<typeof EnvironmentsPanel> = {
  title: 'Panels/EnvironmentsPanel',
  component: EnvironmentsPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Per-environment variable overrides (e.g. `dev`, `prod`). Two nested add/remove levels — environment + its variables. Duplicate environment names or duplicate variable names within an environment render red borders on the offending rows and block save.',
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

type Story = StoryObj<typeof EnvironmentsPanel>;

// Empty — before any environments are defined.
export const Empty: Story = {
  args: { environments: {} },
};

// Populated — dev + prod with realistic overrides (region, scale,
// feature flags). Dev + prod render as separate cards; variables are
// nested rows within each.
export const Populated: Story = {
  args: { environments: populatedSettings.environments },
};
