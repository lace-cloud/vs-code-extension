import { default as EdgeInspectorPanel } from '@lace/canvas/components/panels/EdgeInspectorPanel';
import type { Meta, StoryObj } from '@storybook/react';

// EdgeInspectorPanel opens in the right dock when an edge is selected.
// Small, focused — shows source/target instances + pin names + a
// delete-connection CTA. The rest of the space is intentionally empty
// (wiring has no other editable properties beyond existence).

const meta: Meta<typeof EdgeInspectorPanel> = {
  title: 'Panels/EdgeInspectorPanel',
  component: EdgeInspectorPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Shown when an edge is selected. The panel is deliberately thin — wiring only has existence and endpoints; there\'s nothing else to edit. The primary affordance is "Delete connection" in the sticky footer.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          width: 420,
          height: '100vh',
          background: 'var(--lace-color-bg-canvas)',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    onDelete: () => {},
    onClose: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof EdgeInspectorPanel>;

// Typical connection — exercises the title eyebrow, monospace wiring
// display, helper text, and the destructive footer button.
export const Default: Story = {
  args: {
    source: 'iam_role',
    target: 'attachment',
    sourceOutput: 'role_name',
    targetInput: 'role_name',
  },
};
