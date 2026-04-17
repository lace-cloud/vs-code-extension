import { Button, Modal } from '@lace/ui';
import type { Meta, StoryObj } from '@storybook/react';
import { MockFlowDecorator } from '../../../decorators/mock-flow-decorator';
import { iamStackFixture } from '../../../mocks/fixtures';

// Scene — the Modal primitive composed over the canvas, showing the
// "Clear all modules?" destructive-confirm pattern. The canvas itself
// currently fires Clear without a confirmation (see Canvas.tsx's
// onClearGraph); this scene captures the intended UX so the Modal's
// backdrop + canvas interaction is Chromatic-locked before the confirm
// flow lands in canvas proper.

const meta: Meta = {
  title: 'Flows/Scene/ConfirmClear',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <>
      <MockFlowDecorator fixture={iamStackFixture} />
      <Modal
        open
        tone="danger"
        onClose={() => {}}
        title="Clear all modules?"
        footer={
          <>
            <Button variant="secondary">Cancel</Button>
            <Button variant="danger">Clear all</Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          This removes every module, binding, and group from the canvas. The underlying{' '}
          <code style={{ color: 'var(--lace-color-accent)' }}>.tf</code> files are not touched —
          re-generate to reflect the cleared state.
        </p>
      </Modal>
    </>
  ),
};
