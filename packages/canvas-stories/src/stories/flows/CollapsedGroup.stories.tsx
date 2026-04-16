import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Group collapse flow: loads the CLI's `collapsed-group` seed — a group
// containing multiple instances with `collapsed=true`. Verifies group
// rendering, collapsed visual state, and hidden children handling.

const meta: Meta = {
  title: 'Flows/CollapsedGroup',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <FlowDecorator fixtureName="collapsed-group" />,
};
