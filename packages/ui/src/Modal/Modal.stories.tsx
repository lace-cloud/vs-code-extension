import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../Button';
import { Modal } from './Modal';

const meta: Meta<typeof Modal> = {
  title: 'UI / Modal',
  component: Modal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Centered dialog over a full-viewport backdrop. Backdrop click and the Escape key dismiss. Use `tone="danger"` for destructive confirmations and error dialogs. Consumers own the footer actions; Modal owns the chrome.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    open: true,
    onClose: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof Modal>;

export const Default: Story = {
  args: {
    title: 'Confirm rename',
    children: (
      <p style={{ margin: 0 }}>
        Rename <code style={{ color: 'var(--lace-green)' }}>vpc</code> to{' '}
        <code style={{ color: 'var(--lace-green)' }}>primary_vpc</code>? References in other modules
        will be rewritten automatically.
      </p>
    ),
    footer: (
      <>
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary">Rename</Button>
      </>
    ),
  },
};

export const Danger: Story = {
  args: {
    title: 'Clear all modules?',
    tone: 'danger',
    children: (
      <p style={{ margin: 0 }}>
        This removes every module, binding, and group from the canvas. The underlying{' '}
        <code style={{ color: 'var(--lace-green)' }}>.tf</code> files are not touched — re-generate
        to reflect the cleared state.
      </p>
    ),
    footer: (
      <>
        <Button variant="secondary">Cancel</Button>
        <Button variant="danger">Clear all</Button>
      </>
    ),
  },
};

export const LongContent: Story = {
  args: {
    title: 'Release notes — v1.4.0',
    children: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: 20 }, (_, i) => `change-${i + 1}`).map((key, i) => (
          <p key={key} style={{ margin: 0 }}>
            Change #{i + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus sit
            amet ipsum vel orci laoreet fermentum.
          </p>
        ))}
      </div>
    ),
    footer: <Button variant="primary">Got it</Button>,
  },
};

export const NoFooter: Story = {
  args: {
    title: 'Heads up',
    children: (
      <p style={{ margin: 0 }}>
        Lace saved your canvas layout. Close this dialog or press Escape to continue.
      </p>
    ),
  },
};
