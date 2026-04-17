import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — canvas with the minimap visible (the Canvas default).
// ActionBar's toggle shows the solid map icon; the minimap sits in
// the bottom-left, zoom controls detached in the bottom-right.
// Pairs with MiniMapHidden.

const meta: Meta = {
  title: 'Flows/Scene/MiniMapVisible',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <MockFlowDecorator fixture={iamStackFixture} />,
};
