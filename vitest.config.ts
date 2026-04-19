import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/chat-sidebar/src/__tests__/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true,
  },
});
