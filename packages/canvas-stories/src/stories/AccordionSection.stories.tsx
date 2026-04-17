import AccordionSection from '@lace/canvas/components/AccordionSection';
import type { Meta, StoryObj } from '@storybook/react';

// AccordionSection is a whole-row-click collapsible used inside the
// config panels. Chevron rotates 0→90 on open, body height animates
// via the grid-template-rows trick.

const meta: Meta<typeof AccordionSection> = {
  title: 'Components/AccordionSection',
  component: AccordionSection,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Collapsible section used inside settings + config panels. Whole-row click toggles. Optional trailing badge counts the contents (e.g. `(3)` for "3 required inputs"). Heavy body content is clipped to zero height when closed via a CSS grid trick — no JS measurements, no layout thrash.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          width: 400,
          background: 'var(--lace-color-bg-surface)',
          color: 'var(--lace-color-text-primary)',
        }}
      >
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof AccordionSection>;

const SampleBody = (
  <div style={{ color: 'var(--lace-color-text-muted)', fontSize: 13, lineHeight: 1.5 }}>
    <p style={{ margin: 0, marginBottom: 8 }}>
      Section body. In real panels this slot holds input fields, mode toggles, and the various
      editors.
    </p>
    <p style={{ margin: 0 }}>Lorem ipsum dolor sit amet.</p>
  </div>
);

// Closed by default — what users see when they first land in a panel
// that has many sections they haven't opened yet.
export const Closed: Story = {
  args: {
    title: 'Optional Inputs',
    badge: '(5)',
    defaultOpen: false,
    children: SampleBody,
  },
};

// Open with content — the active-section state. Covers the expanded
// chevron rotation + body visibility.
export const Open: Story = {
  args: {
    title: 'Required Inputs',
    badge: '(3)',
    defaultOpen: true,
    children: SampleBody,
  },
};
