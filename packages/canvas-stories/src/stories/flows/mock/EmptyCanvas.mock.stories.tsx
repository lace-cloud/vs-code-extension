import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { emptyFixture } from '../../../mocks/fixtures';

// Mock twin of Flows/EmptyCanvas — renders with a captured fixture, no
// live CLI. Chromatic snapshots this to cover flow-level visuals that
// the live-CLI story (Flows/EmptyCanvas) can't because Chromatic's cloud
// has no backend.

const meta: Meta = {
  title: 'Flows/Mock/EmptyCanvas',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <MockFlowDecorator fixture={emptyFixture} />,
};
