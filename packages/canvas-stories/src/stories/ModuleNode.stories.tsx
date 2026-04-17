import ModuleNode, { type ModuleNodeData } from '@lace/canvas/components/nodes/ModuleNode';
import type { Meta, StoryObj } from '@storybook/react';
import { type Node, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { MockCanvasContext } from '../mocks/canvas-context';

const nodeTypes = { moduleNode: ModuleNode };

type StoryArgs = { data: ModuleNodeData };

const meta: Meta<StoryArgs> = {
  title: 'Components/ModuleNode',
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <MockCanvasContext>
        <div style={{ width: 600, height: 400, background: 'var(--lace-night)' }}>
          <ReactFlowProvider>
            <Story />
          </ReactFlowProvider>
        </div>
      </MockCanvasContext>
    ),
  ],
  render: (args) => {
    const nodes: Node<ModuleNodeData>[] = [
      {
        id: args.data.id,
        type: 'moduleNode',
        position: { x: 100, y: 100 },
        data: args.data,
      },
    ];
    return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} fitView />;
  },
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const SimpleModule: Story = {
  args: {
    data: {
      id: 'vpc',
      label: 'aws/vpc',
      kind: 'module',
      module_key: 'aws/vpc@v1.0.0',
      position: { x: 0, y: 0 },
      has_errors: false,
      error_messages: [],
      inputs: [
        { name: 'cidr_block', type: 'string', type_family: 'string', required: true },
        { name: 'tags', type: 'map(string)', type_family: 'map', required: false },
      ],
      outputs: [{ name: 'vpc_id', type: 'string', type_family: 'string' }],
    },
  },
};

export const WithError: Story = {
  args: {
    data: {
      id: 'subnet',
      label: 'aws/subnet',
      kind: 'module',
      module_key: 'aws/subnet@v1.0.0',
      position: { x: 0, y: 0 },
      has_errors: true,
      error_messages: ['Required input "cidr_block" is not set'],
      inputs: [
        { name: 'vpc_id', type: 'string', type_family: 'string', required: true, wired: true },
        { name: 'cidr_block', type: 'string', type_family: 'string', required: true },
      ],
      outputs: [{ name: 'subnet_id', type: 'string', type_family: 'string' }],
      hasValidationError: true,
    },
  },
};

export const NewlyAdded: Story = {
  args: {
    data: {
      id: 'new_node',
      label: 'aws/iam-role',
      kind: 'module',
      module_key: 'aws/iam-role@v1.0.0',
      position: { x: 0, y: 0 },
      has_errors: false,
      error_messages: [],
      inputs: [{ name: 'role_name', type: 'string', type_family: 'string', required: true }],
      outputs: [{ name: 'role_arn', type: 'string', type_family: 'string' }],
      isNew: true,
    },
  },
};

export const ManyPins: Story = {
  args: {
    data: {
      id: 'complex',
      label: 'aws/eks-cluster',
      kind: 'module',
      module_key: 'aws/eks-cluster@v2.1.0',
      position: { x: 0, y: 0 },
      has_errors: false,
      error_messages: [],
      inputs: [
        { name: 'cluster_name', type: 'string', type_family: 'string', required: true },
        { name: 'vpc_id', type: 'string', type_family: 'string', required: true },
        { name: 'subnet_ids', type: 'list(string)', type_family: 'list', required: true },
        { name: 'version', type: 'string', type_family: 'string', required: false },
        { name: 'tags', type: 'map(string)', type_family: 'map', required: false },
        { name: 'enable_logging', type: 'bool', type_family: 'bool', required: false },
        { name: 'max_nodes', type: 'number', type_family: 'number', required: false },
      ],
      outputs: [
        { name: 'cluster_id', type: 'string', type_family: 'string' },
        { name: 'cluster_endpoint', type: 'string', type_family: 'string' },
        { name: 'cluster_arn', type: 'string', type_family: 'string' },
      ],
    },
  },
};

export const Resource: Story = {
  args: {
    data: {
      id: 'my_bucket',
      label: 'aws_s3_bucket.example',
      kind: 'resource',
      position: { x: 0, y: 0 },
      has_errors: false,
      error_messages: [],
      inputs: [{ name: 'bucket', type: 'string', type_family: 'string', required: true }],
      outputs: [{ name: 'arn', type: 'string', type_family: 'string' }],
    },
  },
};
