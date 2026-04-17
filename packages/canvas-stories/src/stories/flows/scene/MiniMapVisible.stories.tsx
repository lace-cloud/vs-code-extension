import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — canvas after the user has opted the minimap in via the
// ActionBar toggle. Minimap sits bottom-left (140×100); zoom controls
// remain detached in the bottom-right. The toggle icon flips to the
// solid-map variant. Pairs with MiniMapHidden (the default state).

const meta: Meta = {
  title: 'Flows/Scene/MiniMapVisible',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <MockFlowDecorator
      fixture={iamStackFixture}
      onReady={() => {
        // MiniMap defaults off; click the ActionBar toggle so the scene
        // captures the opted-in state. aria-label is stable across
        // DOM shuffles.
        requestAnimationFrame(() => {
          const btn = document.querySelector<HTMLButtonElement>('[aria-label="Show minimap"]');
          btn?.click();
        });
      }}
    />
  ),
};
