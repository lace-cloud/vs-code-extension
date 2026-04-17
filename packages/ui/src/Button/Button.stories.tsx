import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'UI / Button',
  component: Button,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Primary labelled-button primitive. Variants: primary (default CTA), secondary (neutral), success, danger, ghost. Sizes: sm, md, lg. Supports disabled + loading states.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'success', 'danger', 'ghost'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { children: 'Save changes', variant: 'primary' },
};

export const Secondary: Story = {
  args: { children: 'Cancel', variant: 'secondary' },
};

export const Success: Story = {
  args: { children: 'Saved ✓', variant: 'success' },
};

export const Danger: Story = {
  args: { children: 'Delete module', variant: 'danger' },
};

export const Ghost: Story = {
  args: { children: 'Dismiss', variant: 'ghost' },
};

export const Disabled: Story = {
  args: { children: 'Save changes', variant: 'primary', disabled: true },
};

export const Loading: Story = {
  args: { children: 'Saving…', variant: 'primary', loading: true },
};

// Layout story — all variants side-by-side at md size, for quick pixel-regression
// capture. Chromatic diffs against this image catch cross-variant changes in
// spacing, border-radius, font metrics, etc. without chasing per-variant screens.
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="success">Success</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const StateMatrix: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr 1fr 1fr',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <div />
      <div style={{ color: 'var(--lace-color-text-muted)', fontSize: 11 }}>Idle</div>
      <div style={{ color: 'var(--lace-color-text-muted)', fontSize: 11 }}>Disabled</div>
      <div style={{ color: 'var(--lace-color-text-muted)', fontSize: 11 }}>Loading</div>
      {(['primary', 'secondary', 'success', 'danger'] as const).flatMap((variant) => [
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
        <Button key={`${variant}-idle`} variant={variant}>
          Label
        </Button>,
        <Button key={`${variant}-disabled`} variant={variant} disabled>
          Label
        </Button>,
        <Button key={`${variant}-loading`} variant={variant} loading>
          Label
        </Button>,
      ])}
    </div>
  ),
};
