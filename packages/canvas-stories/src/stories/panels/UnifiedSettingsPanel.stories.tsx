import { UnifiedSettingsPanel } from '@lace/canvas';
import type { Meta, StoryObj } from '@storybook/react';
import { useMemo } from 'react';
import { emptyFixture } from '../../mocks/fixtures';
import { emptySettings, populatedSettings } from '../../mocks/fixtures/configs';
import { MockCanvasEngine } from '../../mocks/mock-engine';

// UnifiedSettingsPanel stacks the four settings surfaces into one
// accordion column: Terraform Config, Providers, Locals, Environments.
// The full-canvas view of this panel with canvas behind lives in the
// `Flows/Scene/SettingsOpen` scene.

type StoryArgs = {
  settings: typeof populatedSettings | 'loading';
};

const meta: Meta<StoryArgs> = {
  title: 'Panels/UnifiedSettingsPanel',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The unified settings surface: Terraform Config (open by default), then Providers, Locals, Environments in AccordionSections. Opens from the ActionBar gear. Each accordion embeds the `-Content` component from the corresponding panel module — not the full panel.',
      },
    },
  },
  decorators: [
    (Story) => (
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
    ),
  ],
  render: (args) => {
    const engine = useMemo(() => {
      if (args.settings === 'loading') {
        const e = new MockCanvasEngine(emptyFixture);
        e.querySettings = () => new Promise(() => {});
        return e;
      }
      return new MockCanvasEngine(emptyFixture, { settings: args.settings });
    }, [args.settings]);

    return <UnifiedSettingsPanel engine={engine} onClose={() => {}} onSaved={() => {}} />;
  },
};
export default meta;

type Story = StoryObj<StoryArgs>;

// Loading — the brief state while settings are fetched.
export const Loading: Story = {
  args: { settings: 'loading' },
};

// Populated — everything filled in: required_version + 2 providers +
// 2 locals + 2 environments. Covers every accordion in its "has
// content" state.
export const Populated: Story = {
  args: { settings: populatedSettings },
};

// Empty — all accordions render with empty bodies + "+ Add X" CTAs.
// First-time-project state.
export const Empty: Story = {
  args: { settings: emptySettings },
};
