import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Multi-module flow: loads the CLI's `iam-stack` seed — two modules placed
// but unwired. Exercises the user-wires-manually path (drag-to-connect
// handles, unwired-input warnings).

const meta: Meta = {
  title: 'Flows/IamStack',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <FlowDecorator fixtureName="iam-stack" />,
};
