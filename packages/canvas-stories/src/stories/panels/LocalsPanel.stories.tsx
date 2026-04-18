import { LocalsPanel } from '@lace/canvas';
import type { Meta, StoryObj } from '@storybook/react';
import { populatedSettings } from '../../mocks/fixtures/configs';

// LocalsPanel edits Terraform `locals {}`: each row is a name + mode
// toggle (Literal / Expression) + multi-line value editor. Duplicate
// names flag as an error and block save.

const meta: Meta<typeof LocalsPanel> = {
  title: 'Panels/LocalsPanel',
  component: LocalsPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Edits `locals {}` entries. Each row is a name + mode toggle (Literal/Expression) + multi-line value. Duplicate local names render the name input with the error border + block the save button — consistent with the EnvironmentsPanel pattern.',
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

type Story = StoryObj<typeof LocalsPanel>;

// Empty state — first-time users see this before adding any locals.
// The "+ Add local" button is the primary affordance.
export const Empty: Story = {
  args: { locals: [] },
};

// Populated — mix of literal + expression modes. Expression uses the
// mono Textarea variant; literal uses a JSON-ish textarea. Covers the
// ModeToggle binding-mode + Textarea integration inside a config panel.
export const Populated: Story = {
  args: { locals: populatedSettings.locals },
};
