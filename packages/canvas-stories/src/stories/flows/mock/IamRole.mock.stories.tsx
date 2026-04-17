import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamRoleFixture } from '../../../mocks/fixtures';

// Mock twin of Flows/IamRole — single-node flow backed by the captured
// `iam-role` fixture. Exercises single-node rendering + pin layout.

const meta: Meta = {
  title: 'Flows/Mock/IamRole',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <MockFlowDecorator fixture={iamRoleFixture} />,
};
