import { default as ModuleConfigPanel } from '@lace/canvas/components/panels/ModuleConfigPanel';
import type { Meta, StoryObj } from '@storybook/react';
import { useMemo } from 'react';
import { MockCanvasContext } from '../../mocks/canvas-context';
import { emptyFixture } from '../../mocks/fixtures';
import { attachmentNodeConfig, vpcNodeConfig } from '../../mocks/fixtures/configs';
import { MockCanvasEngine } from '../../mocks/mock-engine';

// ModuleConfigPanel is the largest + most interactive composite in
// canvas. These stories exercise its state space: loading, populated
// with literal/variable/empty modes, and the wired-editor+disconnect
// flow. Each story injects its own NodeConfig fixture into the mock
// engine via the `nodeConfigs` option.

type StoryArgs = {
  instanceId: string;
  nodeConfig: typeof vpcNodeConfig | 'loading';
};

const meta: Meta<StoryArgs> = {
  title: 'Panels/ModuleConfigPanel',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The module config panel — shown when the user clicks a placed module. Sections: Required Inputs, Optional Inputs, Depends On, Outputs. Per-input mode toggle (Lit/Var/Expr/Wired) drives which editor renders. Wired inputs are read-only with a disconnect-only affordance. Saves all non-wired inputs + depends_on in one batch.',
      },
    },
  },
  decorators: [
    (Story) => (
      <MockCanvasContext view={emptyFixture}>
        <div
          style={{
            position: 'relative',
            width: 520,
            height: '100vh',
            background: 'var(--lace-color-bg-canvas)',
          }}
        >
          <Story />
        </div>
      </MockCanvasContext>
    ),
  ],
  render: (args) => {
    const engine = useMemo(() => {
      if (args.nodeConfig === 'loading') {
        // Build an engine whose queryNodeConfig never resolves so the
        // panel stays in its "Loading configuration..." state.
        const e = new MockCanvasEngine(emptyFixture);
        e.queryNodeConfig = () => new Promise(() => {});
        return e;
      }
      return new MockCanvasEngine(emptyFixture, {
        nodeConfigs: { [args.nodeConfig.instance_id]: args.nodeConfig },
      });
    }, [args.nodeConfig]);

    return (
      <ModuleConfigPanel
        instance_id={args.instanceId}
        engine={engine}
        onClose={() => {}}
        onModified={() => {}}
      />
    );
  },
};
export default meta;

type Story = StoryObj<StoryArgs>;

// Loading — what the user sees between clicking a module and the
// config panel hydrating. The panel shell is always rendered; only
// the body content swaps.
export const Loading: Story = {
  args: { instanceId: 'vpc', nodeConfig: 'loading' },
};

// Populated with required + optional + outputs — the happy path.
// Exercises the mode toggle (Lit/Var/Expr), literal value display,
// variable-name editor, and the outputs-list view.
export const PopulatedRequiredAndOptional: Story = {
  name: 'Populated — required + optional inputs',
  args: { instanceId: 'vpc', nodeConfig: vpcNodeConfig },
};

// Wired inputs — covers the "input is already connected" state: a
// read-only editor + Wired badge + disconnect button. All non-wired
// binding modes are disabled (per design, to prevent the user from
// silently overwriting a live binding). Matches the real iam-stack
// attachment module.
export const WiredInputs: Story = {
  name: 'Wired inputs (disconnect flow)',
  args: { instanceId: 'attachment', nodeConfig: attachmentNodeConfig },
};
