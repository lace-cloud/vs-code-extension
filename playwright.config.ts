import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for flow-story golden-path tests.
 *
 * Visual regression for these tests runs through Chromatic (Playwright
 * mode) — see tests/flow/canvas-golden-paths.spec.ts. Baselines live in
 * Chromatic's cloud, not git. CI passes CHROMATIC_PROJECT_TOKEN; screenshots
 * captured via @chromatic-com/playwright's `takeSnapshot` are uploaded and
 * diffed in the Chromatic UI. Approve/reject happens there, not in GitHub.
 *
 * Deterministic rendering (pinned viewport/locale/timezone/colorScheme)
 * still matters — Chromatic's diff threshold is tight; environmental drift
 * between runs produces noisy PR comments.
 */
export default defineConfig({
  testDir: './tests/flow',
  // Seed-drift canary must run BEFORE the screenshot tests so a hash
  // mismatch fails fast with a clear error.
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:6006',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // `dev:storybook-flows` spawns `lace engine`, parses handshake,
    // exports STORYBOOK_LACE_ENGINE_URL/_TOKEN, and launches Storybook.
    // One command — Playwright waits for :6006 before tests start.
    command: 'pnpm run dev:storybook-flows',
    url: 'http://localhost:6006',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
