import EdgeInspectorPanel from '@lace/canvas/components/panels/EdgeInspectorPanel';
import SlidePanel from '@lace/canvas/components/SlidePanel';
import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — canvas with the EdgeInspectorPanel docked right, as the
// user sees after selecting an edge. The panel is overlaid directly
// (rather than triggered via an edge click) because xyflow's React
// synthetic event system doesn't respond to native dispatchEvent,
// so there's no way to trigger edge selection from story code
// without instrumentation the canvas doesn't have. The visual
// composition — panel over canvas — is what Chromatic captures.

const meta: Meta = {
  title: 'Flows/Scene/EdgeSelected',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <>
      <MockFlowDecorator fixture={iamStackFixture} />
      <SlidePanel open zIndex={40}>
        <EdgeInspectorPanel
          source="iam_role"
          target="attachment"
          sourceOutput="role_name"
          targetInput="role_name"
          onDelete={() => {}}
          onClose={() => {}}
        />
      </SlidePanel>
    </>
  ),
};
