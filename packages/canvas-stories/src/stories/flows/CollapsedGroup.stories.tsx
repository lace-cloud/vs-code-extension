import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FlowDecorator } from '../../decorators/flow-decorator';

// Place three modules, group them, then collapse the group. Verifies
// CreateGroup + UpdateGroup{collapsed:true} rendering, per the
// canvas-groups feature.

const meta: Meta = {
  title: 'Flows/CollapsedGroup',
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
          position: { x: 280, y: 80 },
        });
        const view = await engine.placeModule({
          name: 'iam-user',
          system: 'aws',
          version: '1.0.0',
          position: { x: 500, y: 80 },
        });
        const nodeIds = view.nodes.map((n) => n.id);
        if (nodeIds.length >= 3) {
          const grouped = await engine.createGroup('IAM', nodeIds);
          const groupId = grouped.groups[grouped.groups.length - 1]?.id;
          if (groupId) {
            await engine.updateGroup(groupId, { collapsed: true });
          }
        }
      }}
    />
  ),
};
