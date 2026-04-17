import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { collapsedGroupFixture } from '../../../mocks/fixtures';

// Mock twin of Flows/CollapsedGroup — group with `collapsed=true`.
// Exercises group rendering + hidden-children handling.

const meta: Meta = {
  title: 'Flows/Mock/CollapsedGroup',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <MockFlowDecorator fixture={collapsedGroupFixture} />,
};
