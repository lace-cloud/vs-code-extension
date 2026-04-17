import { Toast } from '@lace/canvas';
import type { Meta, StoryObj } from '@storybook/react';

// Three stories — one per semantic type. Multiple progress-phase
// messages (e.g. Generating vs. Formatting) render identically, so a
// single Progress story is canonical.

const meta: Meta<typeof Toast> = {
  title: 'Components/Toast',
  component: Toast,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Transient top-left banner. Success + error auto-dismiss after 1.5s / 3s; progress stays pinned until a terminal event (Success/Error) supersedes it. All three types use the same geometry — differences are color + the spinner on progress.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          width: 480,
          height: 200,
          background: 'var(--lace-color-bg-canvas)',
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Toast>;

export const Success: Story = {
  args: {
    toast: { message: 'Terraform generated in .lace/', type: 'success' },
  },
};

export const ErrorState: Story = {
  args: {
    toast: { message: 'Failed to validate: missing cidr_block', type: 'error' },
  },
};

export const Progress: Story = {
  args: {
    toast: { message: 'Generating Terraform...', type: 'progress' },
  },
};
