import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Most common user action: place a single module. Asserts PlaceModule RPC
// works end-to-end — request serialization, response parsing, and the
// Subscribe stream's StateUpdated re-render.

const meta: Meta = {
  title: 'Flows/IamRole',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <FlowDecorator
      prologue={async (engine) => {
        await engine.placeModule({
          name: 'iam-role',
          system: 'aws',
          version: '1.0.0',
          position: { x: 80, y: 80 },
        });
      }}
    />
  ),
};
