import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Mock twin of Flows/IamStack — module-tree flow with nested modules
// and their wired pins. Covers composite-module rendering paths.

const meta: Meta = {
  title: 'Flows/Mock/IamStack',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <MockFlowDecorator fixture={iamStackFixture} />,
};
