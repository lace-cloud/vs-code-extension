import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Textarea } from './Textarea';

const meta: Meta<typeof Textarea> = {
  title: 'UI / Textarea',
  component: Textarea,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Multi-line text primitive. Same visual language as Input. `mono` for expression / code values, `resizable={false}` to disable the browser resize handle.',
      },
    },
  },
  argTypes: {
    rows: { control: 'number' },
    error: { control: 'boolean' },
    mono: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof Textarea>;

function Controlled(args: React.ComponentProps<typeof Textarea>) {
  const [value, setValue] = useState(args.value ?? '');
  return <Textarea {...args} value={value} onChange={(e) => setValue(e.target.value)} />;
}

export const Default: Story = {
  args: { value: '', placeholder: 'Enter a value…', fullWidth: true },
  decorators: [(Story) => <div style={{ width: 360 }}>{Story()}</div>],
  render: (args) => <Controlled {...args} />,
};

// HCL interpolation example — the `${...}` in the string is Terraform
// syntax, not a JS template placeholder, so we silence biome here.
// biome-ignore lint/suspicious/noTemplateCurlyInString: Terraform expression sample
const EXPRESSION_EXAMPLE = '"${var.environment}-${var.role_name}"';

export const Expression: Story = {
  args: {
    value: EXPRESSION_EXAMPLE,
    mono: true,
    fullWidth: true,
    rows: 3,
  },
  decorators: [(Story) => <div style={{ width: 360 }}>{Story()}</div>],
  render: (args) => <Controlled {...args} />,
};

export const ErrorState: Story = {
  args: { value: 'invalid json {', error: true, mono: true, fullWidth: true },
  decorators: [(Story) => <div style={{ width: 360 }}>{Story()}</div>],
  render: (args) => <Controlled {...args} />,
};

export const NonResizable: Story = {
  args: { value: 'Fixed-height area.', resizable: false, fullWidth: true, rows: 4 },
  decorators: [(Story) => <div style={{ width: 360 }}>{Story()}</div>],
  render: (args) => <Controlled {...args} />,
};
