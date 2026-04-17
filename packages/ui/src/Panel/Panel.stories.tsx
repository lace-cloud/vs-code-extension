import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../Button';
import { Panel } from './Panel';

const meta: Meta<typeof Panel> = {
  title: 'UI / Panel',
  component: Panel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Side-panel surface: header with title + close button, scrollable body, optional sticky footer. Composites position the panel (slide-in, docked, etc.); Panel owns the frame only.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          width: 480,
          height: 560,
          background: 'var(--lace-night)',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    onClose: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof Panel>;

const SampleBody = (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
    <p style={{ margin: 0, color: 'var(--lace-text-muted)' }}>
      Panel contents go here — module config, edge inspector, settings, etc. The body scrolls
      vertically when content exceeds the frame.
    </p>
    {Array.from({ length: 12 }, (_, i) => `row-${i + 1}`).map((key, i) => (
      <div
        key={key}
        style={{
          background: 'var(--lace-bg-input)',
          border: '1px solid var(--lace-border-default)',
          borderRadius: 4,
          padding: 8,
          color: 'var(--lace-text-label)',
        }}
      >
        Row {i + 1}
      </div>
    ))}
  </div>
);

export const Default: Story = {
  args: {
    title: 'Module Config',
    children: SampleBody,
  },
};

export const WithFooter: Story = {
  args: {
    title: 'Module Config',
    children: SampleBody,
    footer: (
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary">Save</Button>
      </div>
    ),
  },
};

export const NonScrollable: Story = {
  args: {
    title: 'Empty State',
    scrollable: false,
    children: (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--lace-text-muted)',
          fontSize: 13,
        }}
      >
        No module selected.
      </div>
    ),
  },
};

export const NarrowWidth: Story = {
  args: {
    title: 'Mini',
    width: 280,
    children: SampleBody,
  },
};
