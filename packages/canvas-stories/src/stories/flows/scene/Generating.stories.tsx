import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — canvas mid-generation, progress toast with spinner. Pairs
// with SaveSuccess to lock both transient and success toast visuals.

const meta: Meta = {
  title: 'Flows/Scene/Generating',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <MockFlowDecorator
      fixture={iamStackFixture}
      onReady={(engine) => {
        // Progress toasts already don't auto-dismiss (they clear when a
        // Success/Error event supersedes them), so no durationMs needed.
        engine.emit({ type: 'generateProgress', phase: 'generating' });
      }}
    />
  ),
};
