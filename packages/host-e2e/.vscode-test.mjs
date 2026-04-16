import { defineConfig } from '@vscode/test-cli';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @vscode/test-cli config — Plan 2 Phase G.
//
// Drives `@vscode/test-electron`. Downloads a stable VS Code build (cached
// under .vscode-test/), boots it headless with the Lace extension loaded
// from the repo root, and runs compiled Mocha tests from `out/src/`.
//
// The `test-workspace/` folder below is the VS Code workspace each test
// runs inside — it supplies `getLaceDir()` a folder to resolve against
// and ships a `.vscode/settings.json` that disables engine auto-start so
// tests own the lifecycle.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '..', '..');

export default defineConfig({
  label: 'host-e2e',
  files: 'out/src/**/*.test.js',
  version: 'stable',
  workspaceFolder: path.join(__dirname, 'test-workspace'),
  extensionDevelopmentPath: extensionRoot,
  // Skip the welcome page and other first-run distractions.
  launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
  mocha: {
    ui: 'bdd',
    // Extension activation + engine handshake can take several seconds
    // on a cold cache; budget generously rather than tune per-test.
    timeout: 60_000,
    reporter: 'spec',
  },
});
