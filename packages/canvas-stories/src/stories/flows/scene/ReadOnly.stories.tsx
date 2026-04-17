import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — canvas mounted in read-only mode. Portal and any future
// inspection-only host renders the canvas through this path:
//
// - ActionBar reduces to 2 icons (MiniMap toggle + Settings gear);
//   Save / Clear / Undo / Redo / Generate are gone.
// - ModuleNode hover-delete + node rename are inaccessible.
// - GroupNode ungroup + group rename are inaccessible.
// - Right-click menu is suppressed at the dispatch site.
// - xyflow native props (`nodesConnectable`, `edgesReconnectable`,
//   `deleteKeyCode`) are off.
//
// Drag / zoom / pan / select / expand-collapse groups still work —
// those are view ops.

const meta: Meta = {
  title: 'Flows/Scene/ReadOnly',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <MockFlowDecorator fixture={iamStackFixture} readOnly />,
};
