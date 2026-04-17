import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Module-tree flow: loads the CLI's `iam-stack` seed. Renders as one
// collapsed group at the canvas root (iam_stack), containing a nested
// tree — iam_role (module) + cloudwatch_logs_policy (another collapsed
// group, which itself contains policy + attachment). Exercises the
// collapsed-group pin rail + nested-group hiding paths.

const meta: Meta = {
  title: 'Flows/IamStack',
  // Skip Storybook-mode Chromatic snapshot: flow stories need a live CLI
  // that Chromatic's cloud can't spawn. Playwright flow-tests cover it.
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: true } },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <FlowDecorator fixtureName="iam-stack" />,
};
