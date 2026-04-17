import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { ModeToggle, type ModeToggleItem } from './ModeToggle';

const meta: Meta<typeof ModeToggle> = {
  title: 'UI / ModeToggle',
  component: ModeToggle,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Segmented control. Exactly one item is selected via `aria-pressed`. Per-item `disabled` lets consumers render a state indicator (e.g. `wired`) that can be active but not clickable.',
      },
    },
  },
};
export default meta;

type BindingMode = 'literal' | 'variable' | 'expression' | 'wired';
type Story = StoryObj<typeof ModeToggle<BindingMode>>;

const BINDING_ITEMS: ModeToggleItem<BindingMode>[] = [
  { value: 'literal', label: 'Lit' },
  { value: 'variable', label: 'Var' },
  { value: 'expression', label: 'Expr' },
  { value: 'wired', label: 'Wired', disabled: true, title: 'Connect a pin to wire this input' },
];

function ControlledToggle<V extends string>({
  initial,
  items,
  label,
}: {
  initial: V;
  items: ModeToggleItem<V>[];
  label: string;
}) {
  const [value, setValue] = useState<V>(initial);
  return <ModeToggle value={value} onChange={setValue} items={items} aria-label={label} />;
}

export const BindingMode: Story = {
  render: () => (
    <ControlledToggle<BindingMode> initial="literal" items={BINDING_ITEMS} label="Binding mode" />
  ),
};

export const WiredActiveAndDisabled: Story = {
  name: 'Binding mode / wired state',
  render: () => (
    <ModeToggle<BindingMode>
      value="wired"
      onChange={() => {}}
      items={BINDING_ITEMS.map((i) => ({ ...i, disabled: i.value !== 'wired' }))}
      aria-label="Binding mode (wired)"
    />
  ),
};

export const TwoOption: Story = {
  name: 'Two-option (Lit / Expr)',
  render: () => (
    <ControlledToggle<'literal' | 'expression'>
      initial="literal"
      items={[
        { value: 'literal', label: 'Lit' },
        { value: 'expression', label: 'Expr' },
      ]}
      label="Value mode"
    />
  ),
};

export const Matrix: Story = {
  render: () => (
    <div
      style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'center' }}
    >
      <div style={{ color: 'var(--lace-color-text-muted)', fontSize: 11 }}>literal active</div>
      <ModeToggle<BindingMode>
        value="literal"
        onChange={() => {}}
        items={BINDING_ITEMS}
        aria-label="literal"
      />
      <div style={{ color: 'var(--lace-color-text-muted)', fontSize: 11 }}>variable active</div>
      <ModeToggle<BindingMode>
        value="variable"
        onChange={() => {}}
        items={BINDING_ITEMS}
        aria-label="variable"
      />
      <div style={{ color: 'var(--lace-color-text-muted)', fontSize: 11 }}>expression active</div>
      <ModeToggle<BindingMode>
        value="expression"
        onChange={() => {}}
        items={BINDING_ITEMS}
        aria-label="expression"
      />
      <div style={{ color: 'var(--lace-color-text-muted)', fontSize: 11 }}>wired state</div>
      <ModeToggle<BindingMode>
        value="wired"
        onChange={() => {}}
        items={BINDING_ITEMS.map((i) => ({ ...i, disabled: i.value !== 'wired' }))}
        aria-label="wired"
      />
    </div>
  ),
};
