import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/canvas/src/__tests__/**/*.test.{ts,tsx}',
      'packages/chat-core/src/__tests__/**/*.test.{ts,tsx}',
      'packages/chat-sidebar/src/__tests__/**/*.test.{ts,tsx}',
      'packages/canvas-stories/src/__tests__/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
    passWithNoTests: true,
  },
});
