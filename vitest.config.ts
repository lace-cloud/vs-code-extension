import { defineConfig } from 'vitest/config';

// Three kinds of test, by what each needs to run:
//   unit    nothing but the installed dependencies
//   build   the bundles in out/ (`pnpm build` first)
//   engine  the `lace` CLI that LACE_CLI_VERSION names, in bin/ or on PATH
export default defineConfig({
  test: {
    projects: [
      {
        // The webview pages' components render in the unit tests.
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.build.test.ts', 'src/**/*.engine.test.ts'],
        },
      },
      {
        test: {
          name: 'build',
          environment: 'node',
          include: ['src/**/*.build.test.ts'],
        },
      },
      {
        test: {
          name: 'engine',
          environment: 'node',
          include: ['src/**/*.engine.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
