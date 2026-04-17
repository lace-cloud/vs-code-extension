import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';
import { attachmentNodeConfig } from '../../../mocks/fixtures/configs';

// Scene — canvas with the ModuleConfigPanel open for the attachment
// module. Covers the single most-used UX moment: user clicks a placed
// module → panel slides in from the right dock → user edits bindings.
// The attachment module has two wired inputs, exercising the
// wired-editor + disconnect affordance inside the panel.

const meta: Meta = {
  title: 'Flows/Scene/ConfigOpen',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <MockFlowDecorator
      fixture={iamStackFixture}
      engineOptions={{
        nodeConfigs: { attachment: attachmentNodeConfig },
      }}
      onReady={() => {
        // Canvas routes a click on the module header into a custom
        // 'openNodeConfig' event; the scene dispatches the same event
        // so the panel slides in without needing a synthetic click.
        requestAnimationFrame(() => {
          window.dispatchEvent(
            new CustomEvent('openNodeConfig', {
              detail: { instanceId: 'attachment' },
            }),
          );
        });
      }}
    />
  ),
};
