import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — canvas with the minimap hidden. This is the default canvas
// state (chrome tax at our scale); the ActionBar toggle (between
// Generate and Settings) renders as the strikethrough-map icon.
// Pairs with MiniMapVisible.

const meta: Meta = {
  title: 'Flows/Scene/MiniMapHidden',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <MockFlowDecorator fixture={iamStackFixture} />,
};
