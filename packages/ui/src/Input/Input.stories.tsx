import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Input } from './Input';

const meta: Meta<typeof Input> = {
  title: 'UI / Input',
  component: Input,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Single-line text input. Use `error` for validation states (duplicate names, invalid input), `mono` for code/config fields, `fullWidth` to stretch to the container (default in panels).',
      },
    },
  },
  argTypes: {
    type: { control: 'select', options: ['text', 'password', 'number', 'email', 'url', 'search'] },
    error: { control: 'boolean' },
    mono: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof Input>;

// Controlled wrapper so the field echoes keystrokes in Storybook.
function ControlledInput(args: React.ComponentProps<typeof Input>) {
  const [value, setValue] = useState(args.value ?? '');
  return <Input {...args} value={value} onChange={(e) => setValue(e.target.value)} />;
}

export const Default: Story = {
  args: { value: '', placeholder: 'Type something…' },
  render: (args) => <ControlledInput {...args} />,
};

export const WithValue: Story = {
  args: { value: 'vpc-main' },
  render: (args) => <ControlledInput {...args} />,
};

export const Mono: Story = {
  args: { value: 'module.iam_role.role_arn', mono: true },
  render: (args) => <ControlledInput {...args} />,
};

export const ErrorState: Story = {
  args: { value: 'duplicate_name', error: true },
  render: (args) => <ControlledInput {...args} />,
};

export const Disabled: Story = {
  args: { value: 'Locked field', disabled: true },
  render: (args) => <ControlledInput {...args} />,
};

export const ReadOnly: Story = {
  args: { value: 'aws/vpc@v1.0.0', readOnly: true, mono: true },
  render: (args) => <ControlledInput {...args} />,
};

export const FullWidth: Story = {
  args: { value: '', placeholder: 'Search modules…', fullWidth: true },
  decorators: [(Story) => <div style={{ width: 320 }}>{Story()}</div>],
  render: (args) => <ControlledInput {...args} />,
};

export const StateMatrix: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 12,
        alignItems: 'center',
        width: 380,
      }}
    >
      <div style={{ color: '#999', fontSize: 11 }}>Idle</div>
      <Input value="vpc-main" fullWidth />
      <div style={{ color: '#999', fontSize: 11 }}>Placeholder</div>
      <Input value="" placeholder="Enter a name…" fullWidth />
      <div style={{ color: '#999', fontSize: 11 }}>Mono</div>
      <Input value="module.iam_role.role_arn" mono fullWidth />
      <div style={{ color: '#999', fontSize: 11 }}>Error</div>
      <Input value="duplicate_name" error fullWidth />
      <div style={{ color: '#999', fontSize: 11 }}>Disabled</div>
      <Input value="Locked" disabled fullWidth />
      <div style={{ color: '#999', fontSize: 11 }}>Read-only</div>
      <Input value="aws/vpc@v1.0.0" readOnly mono fullWidth />
    </div>
  ),
};
