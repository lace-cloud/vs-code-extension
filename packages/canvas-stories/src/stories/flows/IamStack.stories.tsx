import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Place two related modules but leave them unwired. User exercises the
// drag-to-connect → Connect RPC flow manually; useful for visual verification
// of edge rendering and unwired-input warnings.

const meta: Meta = {
  title: 'Flows/IamStack',
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
          position: { x: 60, y: 80 },
        });
        await engine.placeModule({
          name: 'iam-policy',
          system: 'aws',
          version: '1.0.0',
          position: { x: 460, y: 80 },
        });
      }}
    />
  ),
};
