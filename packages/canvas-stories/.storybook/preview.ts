import type { Preview } from '@storybook/react';
import './preview.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'lace-dark',
      values: [{ name: 'lace-dark', value: '#161616' }],
    },
    layout: 'centered',
  },
};

export default preview;
