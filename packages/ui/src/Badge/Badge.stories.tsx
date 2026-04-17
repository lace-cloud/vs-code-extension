import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'UI / Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Inline pill used for counts, version tags, and status chips. Variants: neutral (quiet count pill), info (version tag), success (ok state), danger (destructive / error state). Sizes: sm (default), md.',
      },
    },
  },
  argTypes: {
    variant: { control: 'select', options: ['neutral', 'info', 'success', 'danger'] },
    size: { control: 'select', options: ['sm', 'md'] },
  },
};
export default meta;

type Story = StoryObj<typeof Badge>;

export const Neutral: Story = {
  args: { children: '(5)', variant: 'neutral' },
};

export const Info: Story = {
  args: { children: 'v1.0.0', variant: 'info' },
};

export const Success: Story = {
  args: { children: 'Applied', variant: 'success' },
};

export const Danger: Story = {
  args: { children: 'Remove', variant: 'danger' },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Badge variant="neutral">(5)</Badge>
      <Badge variant="info">v1.0.0</Badge>
      <Badge variant="success">Applied</Badge>
      <Badge variant="danger">Remove</Badge>
    </div>
  ),
};

export const SizeMatrix: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr 1fr',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <div />
      <div style={{ color: 'var(--lace-color-text-muted)', fontSize: 11 }}>sm</div>
      <div style={{ color: 'var(--lace-color-text-muted)', fontSize: 11 }}>md</div>
      {(['neutral', 'info', 'success', 'danger'] as const).flatMap((variant) => [
        <div
          key={`${variant}-label`}
          style={{
            color: 'var(--lace-color-text-muted)',
            fontSize: 11,
            textTransform: 'capitalize',
          }}
        >
          {variant}
        </div>,
        <div key={`${variant}-sm`} style={{ justifySelf: 'start' }}>
          <Badge variant={variant} size="sm">
            label
          </Badge>
        </div>,
        <div key={`${variant}-md`} style={{ justifySelf: 'start' }}>
          <Badge variant={variant} size="md">
            label
          </Badge>
        </div>,
      ])}
    </div>
  ),
};
