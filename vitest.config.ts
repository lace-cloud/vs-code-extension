import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/webview/__tests__/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true,
  },
});
