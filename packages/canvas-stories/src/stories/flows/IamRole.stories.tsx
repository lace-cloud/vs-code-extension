import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Single-module flow: loads the CLI's `iam-role` seed — one placed module,
// no wiring. Exercises single-node rendering and pin layout.

const meta: Meta = {
  title: 'Flows/IamRole',
  // Skip Storybook-mode Chromatic snapshot: flow stories need a live CLI
  // that Chromatic's cloud can't spawn. Playwright flow-tests cover it.
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: true } },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <FlowDecorator fixtureName="iam-role" />,
};
