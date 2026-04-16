import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Module-tree flow: loads the CLI's `iam-stack` seed. Renders as one
// collapsed group at the canvas root (iam_stack), containing a nested
// tree — iam_role (leaf) + cloudwatch_logs_policy (another collapsed
// group, which itself contains policy + attachment). Exercises the
// collapsed-group pin rail + nested-group hiding paths.

const meta: Meta = {
  title: 'Flows/IamStack',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <FlowDecorator fixtureName="iam-stack" />,
};
