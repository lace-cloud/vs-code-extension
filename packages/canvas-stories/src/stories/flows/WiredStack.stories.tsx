import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Pre-wired flow: loads the CLI's `wired-stack` seed — three modules
// (iam_role, iam_policy, iam_policy_attachment) with two
// pre-wired edges (role.role_name → attachment.role_name,
// policy.policy_arn → attachment.policy_arn). Clicking the Generate
// button exercises the full GenerateProgress → GenerateSuccess event
// stream + toast surface.

const meta: Meta = {
  title: 'Flows/WiredStack',
  // Skip Storybook-mode Chromatic snapshot: flow stories need a live CLI
  // that Chromatic's cloud can't spawn. Playwright flow-tests cover it.
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: true } },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <FlowDecorator fixtureName="wired-stack" />,
};
