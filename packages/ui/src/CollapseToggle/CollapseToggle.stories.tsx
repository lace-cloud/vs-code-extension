import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { CollapseToggle } from './CollapseToggle';

const meta: Meta<typeof CollapseToggle> = {
  title: 'UI / CollapseToggle',
  component: CollapseToggle,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Rotating chevron button used for accordion-style sections. Chevron points right when closed (`open=false`) and down when open (`open=true`). Accessible via `aria-expanded`.',
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof CollapseToggle>;

export const Closed: Story = {
  args: { open: false, onClick: () => {} },
};

export const Open: Story = {
  args: { open: true, onClick: () => {} },
};

export const InAccordion: Story = {
  name: 'In context — accordion section',
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ width: 320, color: 'var(--lace-grey)', fontSize: 13 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid var(--lace-border-default)',
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          <CollapseToggle open={open} onClick={() => setOpen((v) => !v)} />
          <span style={{ flex: 1 }}>Required inputs</span>
          <span style={{ fontSize: 11, opacity: 0.6, fontWeight: 400 }}>(3)</span>
        </div>
        {open && (
          <div style={{ padding: 12, color: 'var(--lace-text-muted)' }}>
            Section body appears here when open.
          </div>
        )}
      </div>
    );
  },
};
