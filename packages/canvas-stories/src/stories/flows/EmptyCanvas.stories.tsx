import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Sanity-check flow: loads the CLI's `empty` seed fixture — no modules,
// zero errors. Verifies the end-to-end boot path (TestSessionOpen +
// Subscribe stream + initial StateUpdated) against a known-good baseline.
// If the banner shows instead, either the CLI isn't running or env vars
// aren't wired — launch with `pnpm run dev:storybook-flows`.

const meta: Meta = {
  title: 'Flows/EmptyCanvas',
  // Flow stories need a live `lace engine` backend (see FlowDecorator).
  // Chromatic's Storybook cloud can't spawn the CLI, so skip Storybook-mode
  // snapshots — coverage lives in the Playwright flow tests instead.
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: true } },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <FlowDecorator fixtureName="empty" />,
};
