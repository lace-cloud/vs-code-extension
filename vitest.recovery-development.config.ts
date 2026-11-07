import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const repo = resolve(
  __dirname,
  process.env.LACE_DEVELOPMENT_REPO ?? '../lace-batch-review-2026-11-06',
);

// Opt-in development integration: points at an explicitly built engine and
// matching locally built libraries. The release-engine suite remains pinned.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@lace-cloud\/canvas\/engine$/,
        replacement: resolve(repo, 'packages/canvas/src/engine/index.ts'),
      },
      {
        find: /^@lace-cloud\/canvas$/,
        replacement: resolve(repo, 'packages/canvas/src/index.ts'),
      },
      {
        find: /^@lace-cloud\/host$/,
        replacement: resolve(repo, 'packages/host/src/index.ts'),
      },
      {
        find: /^@lace-cloud\/proto$/,
        replacement: resolve(repo, 'packages/proto/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/engine/__tests__/recovery.development.integration.ts'],
    testTimeout: 45_000,
  },
});
