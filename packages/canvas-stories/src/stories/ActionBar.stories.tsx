import { ActionBar } from '@lace/canvas';
import type { Meta, StoryObj } from '@storybook/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useState } from 'react';

// ActionBar renders via an xyflow `<Panel>` which needs a ReactFlow
// context to mount outside of a live canvas. The decorator wraps each
// story in a positioned frame + context so the Panel lands in the top
// right, as in the real canvas.

const meta: Meta<typeof ActionBar> = {
  title: 'Components/ActionBar',
  component: ActionBar,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Top-right toolbar over the canvas. Save / Clear / Undo / Redo / Generate / MiniMap toggle / Settings. The Generate button is the primary CTA; everything else is secondary. `isGenerating` disables Generate during an active run; `showMiniMap` swaps the map icon between solid and strikethrough.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          width: 600,
          height: 200,
          background: 'var(--lace-color-bg-canvas)',
        }}
      >
        <ReactFlowProvider>
          <Story />
        </ReactFlowProvider>
      </div>
    ),
  ],
  args: {
    onSave: () => {},
    onUndo: () => {},
    onRedo: () => {},
    onClearGraph: () => {},
    onGenerate: () => {},
    onOpenSettings: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof ActionBar>;

// Default state — the bar the user sees on first canvas open. MiniMap
// is off by default, so the toggle shows the strikethrough map icon.
export const Default: Story = {
  args: { isGenerating: false, showMiniMap: false, onToggleMiniMap: () => {} },
};

// Mid-generation — Generate button disabled. Users see this during
// the progress → success/error event sequence.
export const Generating: Story = {
  args: { isGenerating: true, showMiniMap: false, onToggleMiniMap: () => {} },
};

// MiniMap opted in — toggle icon swaps to the solid map variant. This
// is the only visual change when the user turns the minimap on.
export const MiniMapShown: Story = {
  args: { isGenerating: false, showMiniMap: true, onToggleMiniMap: () => {} },
};

// Interactive toggle — click the minimap button and it flips between
// the two icon states. Covers the interaction for manual verification.
export const InteractiveMiniMapToggle: Story = {
  name: 'Interactive — MiniMap toggle',
  render: (args) => {
    const [shown, setShown] = useState(false);
    return <ActionBar {...args} showMiniMap={shown} onToggleMiniMap={() => setShown((v) => !v)} />;
  },
};

// Read-only — only MiniMap toggle + Settings gear render. Save,
// Clear, Undo, Redo, and Generate are IR-mutating and hidden. Portal
// and any inspection-only host mount the canvas through this shape.
export const ReadOnly: Story = {
  args: { readOnly: true, isGenerating: false, showMiniMap: false, onToggleMiniMap: () => {} },
};
