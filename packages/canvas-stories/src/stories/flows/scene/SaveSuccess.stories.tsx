import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — canvas with multiple nodes + save-success toast visible in
// the top-right. Covers the "ActionBar + Toast in the same corner"
// layout case that isolated stories cannot exercise.

const meta: Meta = {
  title: 'Flows/Scene/SaveSuccess',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <MockFlowDecorator
      fixture={iamStackFixture}
      onReady={(engine) => {
        // Simulate a just-completed successful generation. `toastDurationMs:
        // Infinity` pins the success toast so Chromatic snapshots the
        // "ActionBar + Toast stacked top-right" layout rather than a
        // cleared viewport 1.5s later.
        engine.emit({
          type: 'generateSuccess',
          files: ['main.tf'],
          toastDurationMs: Number.POSITIVE_INFINITY,
        });
      }}
    />
  ),
};
