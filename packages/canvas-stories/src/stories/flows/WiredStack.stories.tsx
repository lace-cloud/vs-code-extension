import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Two modules, auto-wired. Gives the user a canvas ready to Generate — good
// story for exercising the GenerateProgress → GenerateSuccess event stream
// and the toast flow.

const meta: Meta = {
  title: 'Flows/WiredStack',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <FlowDecorator
      prologue={async (engine) => {
        const viewAfterRole = await engine.placeModule({
          name: 'iam-role',
          system: 'aws',
          version: '1.0.0',
          position: { x: 60, y: 80 },
        });
        const viewAfterPolicy = await engine.placeModule({
          name: 'iam-policy',
          system: 'aws',
          version: '1.0.0',
          position: { x: 460, y: 80 },
        });
        // Best-effort auto-wire: picks the first two instances the CLI
        // reports. If the registry module has no compatible outputs/inputs
        // the user sees the unconnected state and can still trigger Generate.
        const instances = viewAfterPolicy.nodes.map((n) => n.id);
        void viewAfterRole;
        if (instances.length >= 2) {
          try {
            await engine.autoConnect(instances[0], instances[1]);
          } catch {
            /* No compatible wires — not fatal for the story. */
          }
        }
      }}
    />
  ),
};
