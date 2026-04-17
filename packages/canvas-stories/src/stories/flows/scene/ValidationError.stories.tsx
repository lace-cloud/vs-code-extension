import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — canvas with a failed validation showing the persistent
// ValidationErrorBanner + its dismiss affordance. Covers the
// "banner-over-canvas, top-right, below ActionBar" layout case.

const meta: Meta = {
  title: 'Flows/Scene/ValidationError',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <MockFlowDecorator
      fixture={iamStackFixture}
      onReady={(engine) => {
        // `toastDurationMs: 0` clears the transient error toast
        // effectively instantly so the persistent ValidationErrorBanner
        // is the story's focus — it's hidden while a toast is active.
        engine.emit({
          type: 'generateError',
          toastDurationMs: 0,
          message: 'Terraform validation failed',
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
            },
          ],
        });
      }}
    />
  ),
};
