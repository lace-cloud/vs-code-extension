import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { wiredStackFixture } from '../../../mocks/fixtures';

// Mock twin of Flows/WiredStack — three modules with two pre-wired
// edges. Verifies edge rendering + wired-pin visuals.

const meta: Meta = {
  title: 'Flows/Mock/WiredStack',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <MockFlowDecorator fixture={wiredStackFixture} />,
};
