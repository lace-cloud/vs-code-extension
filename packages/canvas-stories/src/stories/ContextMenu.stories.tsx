import ContextMenu from '@lace/canvas/components/ContextMenu';
import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta<typeof ContextMenu> = {
  title: 'Components/ContextMenu',
  component: ContextMenu,
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
          // `transform` creates a containing block, so the menu's
          // `position: fixed` stays inside the decorator box instead of
          // escaping to the viewport. Real-world positioning is unchanged —
          // Canvas has no ancestor transform.
          transform: 'translateZ(0)',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    onCopy: () => {},
    onCut: () => {},
    onPaste: () => {},
    onGroupSelected: () => {},
    onUngroup: () => {},
    onDismiss: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ContextMenu>;

export const SingleNode: Story = {
  args: {
    contextMenu: { x: 40, y: 40, nodeId: 'vpc', groupId: null, selectedCount: 1 },
  },
};

export const MultiSelect: Story = {
  args: {
    contextMenu: { x: 40, y: 40, nodeId: null, groupId: null, selectedCount: 3 },
  },
};

export const GroupRightClick: Story = {
  args: {
    contextMenu: { x: 40, y: 40, nodeId: null, groupId: 'grp-1', selectedCount: 0 },
  },
};
