import Toast from '@lace/canvas/components/Toast';
import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta<typeof Toast> = {
  title: 'Components/Toast',
  component: Toast,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div
        style={{ position: 'relative', width: 400, height: 120, background: 'var(--lace-night)' }}
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

export const ProgressGenerating: Story = {
  args: {
    toast: { message: 'Generating Terraform...', type: 'progress' },
  },
};

export const ProgressFormatting: Story = {
  args: {
    toast: { message: 'Formatting...', type: 'progress' },
  },
};
