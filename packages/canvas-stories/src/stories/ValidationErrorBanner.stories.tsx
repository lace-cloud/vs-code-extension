import { ValidationErrorBanner } from '@lace/canvas/components/ValidationErrorBanner';
import type { Meta, StoryObj } from '@storybook/react';

// ValidationErrorBanner has two faces: the persistent top-left banner
// that appears after a failed generation, and the Modal-style dialog
// that the "View details" button opens. Both are covered here.

const meta: Meta<typeof ValidationErrorBanner> = {
  title: 'Components/ValidationErrorBanner',
  component: ValidationErrorBanner,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Persistent error surface shown after a failed generation. The banner lives in the top-left (not competing with ActionBar in the top-right). Clicking "View details" opens a modal with per-diagnostic line numbers + jump-to-node links. Dismissed banner state is captured via onDismiss; auto-appears again when new errors arrive.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          width: 800,
          height: 200,
          background: 'var(--lace-color-bg-canvas)',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    nodeIds: new Set(['attachment']),
    onGoToNode: () => {},
    onOpenFile: () => {},
    onDismiss: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof ValidationErrorBanner>;

// Banner only — the default visible state. This is what users see
// most often: they generate, validation fails, banner pops, they
// keep working with the banner as a reminder until they fix things.
export const Banner: Story = {
  args: {
    diagnostics: [
      {
        severity: 'error',
        message: 'Required input "role_name" is not set on attachment.',
        instance_id: 'attachment',
        file: 'main.tf',
        line: 12,
        column: 3,
      },
    ],
  },
};

// Banner with multiple diagnostics — exercises the dialog trigger and
// the "multiple errors" messaging. Dialog renders via the Modal
// primitive (`Flows/Scene/ValidationError` covers the full canvas
// composition; this covers the panel itself in isolation).
export const MultipleDiagnostics: Story = {
  name: 'Banner — multiple diagnostics',
  args: {
    diagnostics: [
      {
        severity: 'error',
        message: 'Required input "role_name" is not set on attachment.',
        instance_id: 'attachment',
        file: 'main.tf',
        line: 12,
        column: 3,
      },
      {
        severity: 'error',
        message: 'Invalid value for input "policy_arn" on attachment.',
        instance_id: 'attachment',
        file: 'main.tf',
        line: 15,
      },
      {
        severity: 'error',
        message: 'Unsupported argument "unknown_field" on policy block.',
        address: 'module.policy',
      },
    ],
  },
};
