import { SlidePanel } from '@lace/canvas';
import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta<typeof SlidePanel> = {
  title: 'Components/SlidePanel',
  component: SlidePanel,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          width: 600,
          height: 400,
          background: 'var(--lace-night)',
          overflow: 'hidden',
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SlidePanel>;

const PanelContent = (
  <div
    style={{
      width: 320,
      height: '100%',
      background: 'var(--lace-bg-surface)',
      borderLeft: '1px solid var(--lace-border-default)',
      padding: 16,
      color: 'var(--lace-grey)',
    }}
  >
    <h3 style={{ margin: 0, marginBottom: 12, color: 'var(--lace-green)' }}>Module Config</h3>
    <p style={{ fontSize: 13, lineHeight: 1.5 }}>
      Panel contents go here. Used for module config, edge inspector, settings, etc.
    </p>
  </div>
);

export const Open: Story = {
  args: {
    open: true,
    children: PanelContent,
  },
};

export const Closed: Story = {
  args: {
    open: false,
    children: PanelContent,
  },
};
