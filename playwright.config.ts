import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for flow-story golden-path tests (Plan 2 Phase F).
 *
 * Environment pinning: CI runs inside `mcr.microsoft.com/playwright:v1.59.1-jammy`
 * so Chromium version + fonts + fontconfig match the baselines exactly. Local
 * runs (Mac or other) produce `*-darwin.png` artefacts that are gitignored
 * and not authoritative. Always commit Linux baselines from a CI run.
 *
 * Snapshot path includes {platform} so a mis-committed Darwin baseline
 * cannot overwrite the Linux one.
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
    // Pinned rendering knobs — any environmental drift becomes a visible
    // screenshot diff, which defeats the point of baselining.
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
  expect: {
    // 0.5% — looser than the original 0.1% plan draft. Sub-pixel AA
    // drifts slightly even across identical Chromium versions with
    // different font cache states. Tighten to 0.001 only after two
    // weeks of stable CI at 0.005.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.005,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  snapshotDir: 'tests/flow/__snapshots__',
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}-{projectName}-{platform}{ext}',
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
