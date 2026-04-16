import GroupNode, { type GroupNodeData } from '@lace/canvas/components/nodes/GroupNode';
import type { Meta, StoryObj } from '@storybook/react';
import { type Node, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { MockCanvasContext } from '../mocks/canvas-context';

const nodeTypes = { groupNode: GroupNode };

type StoryArgs = { data: GroupNodeData; width: number; height: number };

const meta: Meta<StoryArgs> = {
  title: 'Components/GroupNode',
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <MockCanvasContext>
        <div style={{ width: 700, height: 500, background: 'var(--lace-night)' }}>
          <ReactFlowProvider>
            <Story />
          </ReactFlowProvider>
        </div>
      </MockCanvasContext>
    ),
  ],
  render: (args) => {
    const nodes: Node<GroupNodeData>[] = [
      {
        id: args.data.groupId,
        type: 'groupNode',
        position: { x: 80, y: 80 },
        data: args.data,
        style: { width: args.width, height: args.height },
      },
    ];
    return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} fitView={false} />;
  },
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Expanded: Story = {
  args: {
    width: 400,
    height: 300,
    data: {
      groupId: 'grp-networking',
      label: 'Networking',
      memberCount: 3,
      collapsed: false,
      hasErrors: false,
      externalPins: [],
    },
  },
};

export const Collapsed: Story = {
  args: {
    width: 220,
    height: 140,
    data: {
      groupId: 'grp-networking',
      label: 'Networking',
      memberCount: 3,
      collapsed: true,
      hasErrors: false,
      externalPins: [
        {
          handleId: 'in:vpc/cidr_block',
          label: 'vpc.cidr_block',
          side: 'input',
          color: { fill: '#95E7FF', stroke: '#2C9DB9' },
        },
        {
          handleId: 'out:subnet/subnet_id',
          label: 'subnet.subnet_id',
          side: 'output',
          color: { fill: '#95E7FF', stroke: '#2C9DB9' },
        },
      ],
    },
  },
};

export const CollapsedWithErrors: Story = {
  args: {
    width: 220,
    height: 140,
    data: {
      groupId: 'grp-broken',
      label: 'Broken Stack',
      memberCount: 2,
      collapsed: true,
      hasErrors: true,
      externalPins: [],
    },
  },
};
