import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Pre-wired flow: loads the CLI's `wired-stack` seed — two modules with a
// live edge between them. Clicking the Generate button exercises the full
// GenerateProgress → GenerateSuccess event stream + toast surface.

const meta: Meta = {
  title: 'Flows/WiredStack',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <FlowDecorator fixtureName="wired-stack" />,
};
