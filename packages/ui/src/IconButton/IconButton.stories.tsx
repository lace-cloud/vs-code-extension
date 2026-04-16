import type { Meta, StoryObj } from '@storybook/react';
import { IconButton } from './IconButton';

const meta: Meta<typeof IconButton> = {
  title: 'UI / IconButton',
  component: IconButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Icon-only button primitive. 14/22/28 px square (xs/sm/md). Variants: default (neutral), danger (red), success (green). `aria-label` is required.',
      },
    },
  },
  argTypes: {
    variant: { control: 'select', options: ['default', 'danger', 'success'] },
    size: { control: 'select', options: ['xs', 'sm', 'md'] },
    disabled: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof IconButton>;

// Emoji works as a ReactNode for story purposes; real consumers will pass SVGs.
const XIcon = '✕';
const CheckIcon = '✓';
const TrashIcon = '🗑';

export const Default: Story = {
  args: { icon: XIcon, 'aria-label': 'Close', variant: 'default' },
};

export const Danger: Story = {
  args: { icon: TrashIcon, 'aria-label': 'Delete', variant: 'danger' },
};

export const Success: Story = {
  args: { icon: CheckIcon, 'aria-label': 'Accept', variant: 'success' },
};

export const Disabled: Story = {
  args: { icon: XIcon, 'aria-label': 'Close', disabled: true },
};

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <IconButton icon={XIcon} aria-label="Close xs" size="xs" />
      <IconButton icon={XIcon} aria-label="Close sm" size="sm" />
      <IconButton icon={XIcon} aria-label="Close md" size="md" />
    </div>
  ),
};

export const VariantMatrix: Story = {
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
      <div style={{ color: '#999', fontSize: 11 }}>xs</div>
      <div style={{ color: '#999', fontSize: 11 }}>sm</div>
      <div style={{ color: '#999', fontSize: 11 }}>md</div>
      {(['default', 'danger', 'success'] as const).flatMap((variant) => [
        <div
          key={`${variant}-label`}
          style={{ color: '#999', fontSize: 11, textTransform: 'capitalize' }}
        >
          {variant}
        </div>,
        <IconButton
          key={`${variant}-xs`}
          icon={XIcon}
          aria-label={`${variant} xs`}
          variant={variant}
          size="xs"
        />,
        <IconButton
          key={`${variant}-sm`}
          icon={XIcon}
          aria-label={`${variant} sm`}
          variant={variant}
          size="sm"
        />,
        <IconButton
          key={`${variant}-md`}
          icon={XIcon}
          aria-label={`${variant} md`}
          variant={variant}
          size="md"
        />,
      ])}
    </div>
  ),
};
