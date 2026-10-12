// The window e2e: the extension, built in the repository's `out/`, loaded
// into a real VS Code that `@vscode/test-cli` downloads, against a real
// engine. Each run opens a workspace of its own: a fresh git repository
// whose settings name the engine. The tests make their module directories
// in it.
//
// The engine is the binary LACE_E2E_ENGINE names, else the `lace` CLI the
// engine tests run (`src/engine/__tests__/engine-binary.mjs`: `bin/lace`,
// else the `lace` on PATH), and either way the release LACE_CLI_VERSION
// names. It reads a Lace config directory of the run's own, so it holds no
// credential: every case here runs signed out.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';
import { releasedEngine } from '../../src/engine/__tests__/engine-binary.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const extension = resolve(here, '..', '..');
const found = releasedEngine(extension, process.env.LACE_E2E_ENGINE);
if ('refusal' in found) throw new Error(found.refusal);
const engine = resolve(found.binary);
if (!existsSync(join(extension, 'out', 'extension.js'))) {
  throw new Error('the extension is not built: run `pnpm build` in the repository first');
}

const run = realpathSync(mkdtempSync(join(tmpdir(), 'lace-host-e2e-')));
const workspace = join(run, 'workspace');
mkdirSync(join(workspace, '.vscode'), { recursive: true });
execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '--quiet', workspace]);
writeFileSync(
  join(workspace, '.vscode', 'settings.json'),
  JSON.stringify(
    {
      'lace.binaryPath': engine,
      'files.autoSave': 'off',
      'git.enabled': false,
      'workbench.startupEditor': 'none',
    },
    null,
    2,
  ),
);
process.on('exit', () => rmSync(run, { recursive: true, force: true }));

export default defineConfig({
  label: 'window',
  files: 'out/**/*.test.js',
  version: 'stable',
  extensionDevelopmentPath: extension,
  workspaceFolder: workspace,
  // VS Code's own state under the run's directory: a short path, since a
  // socket is made in it, and nothing kept from one run to the next.
  launchArgs: [
    '--disable-extensions',
    '--disable-workspace-trust',
    `--user-data-dir=${join(run, 'vscode')}`,
  ],
  env: {
    LACE_E2E_ENGINE: engine,
    LACE_CONFIG_DIR: join(run, 'lace-config'),
    LACE_API_KEY: undefined,
    LACE_ORGANIZATION: undefined,
    LACE_TEAM: undefined,
  },
  mocha: { ui: 'bdd', timeout: 120_000, reporter: 'spec' },
});
