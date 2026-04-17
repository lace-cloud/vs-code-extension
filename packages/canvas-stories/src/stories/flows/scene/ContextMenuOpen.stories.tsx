import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — canvas with the right-click ContextMenu open over a node.
// Positioned at fixed coords inside the canvas frame so the menu's
// relationship to the right-clicked node is consistent across
// snapshots. Covers the "menu over node" composition + the overlay's
// dismiss-on-outside-click scrim.

const meta: Meta = {
  title: 'Flows/Scene/ContextMenuOpen',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <MockFlowDecorator
      fixture={iamStackFixture}
      onReady={() => {
        // Canvas listens on window for `canvasContextMenu` and renders
        // ContextMenu at the detail coordinates. Dispatching the same
        // event is what an actual right-click on a node does.
        requestAnimationFrame(() => {
          window.dispatchEvent(
            new CustomEvent('canvasContextMenu', {
              detail: {
                instanceId: 'attachment',
                groupId: null,
                selectedCount: 1,
                x: 320,
                y: 260,
              },
            }),
          );
        });
      }}
    />
  ),
};
