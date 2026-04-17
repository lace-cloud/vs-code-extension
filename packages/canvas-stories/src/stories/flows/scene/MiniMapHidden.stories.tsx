import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — canvas with the minimap hidden. The toggle affordance in the
// ActionBar (between Generate and Settings) should render as the
// strikethrough map icon. Acts as the twin of MiniMapVisible to lock
// in the toggle's visual states.
//
// Canvas's `showMiniMap` state defaults to `true`; the decorator
// dispatches a click on the toggle in onReady so Chromatic captures
// the hidden state.

const meta: Meta = {
  title: 'Flows/Scene/MiniMapHidden',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <MockFlowDecorator
      fixture={iamStackFixture}
      onReady={() => {
        // Click the toggle button to flip the minimap off. Query by
        // aria-label so the test doesn't depend on DOM structure.
        requestAnimationFrame(() => {
          const btn = document.querySelector<HTMLButtonElement>('[aria-label="Hide minimap"]');
          btn?.click();
        });
      }}
    />
  ),
};
