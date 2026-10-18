// The window e2e: the extension, built in the repository's `out/`, loaded
// into a real VS Code that `@vscode/test-cli` downloads, against a real
// engine. Each suite runs in a window of its own, opened on a workspace of
// its own: a fresh git repository whose settings name the engine. The
// `window` suites make their module directories in theirs; the `empty
// workspace` suites run in one that holds no Terraform.
//
// The engine is the binary LACE_E2E_ENGINE names, else the `lace` CLI the
// engine tests run (`src/engine/__tests__/engine-binary.mjs`: `bin/lace`,
// else the `lace` on PATH), and either way the release LACE_CLI_VERSION
// names. The windows run for a developer of the run's own, in a home of the
// run's own, as the engine tests do (`signedOutEnvironment`): every case
// here runs signed out, whatever the shell that runs the e2e holds.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';
import { releasedEngine, signedOutEnvironment } from '../../src/engine/__tests__/engine-binary.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const extension = resolve(here, '..', '..');
const found = releasedEngine(extension, process.env.LACE_E2E_ENGINE);
if ('refusal' in found) throw new Error(found.refusal);
const engine = resolve(found.binary);
if (!existsSync(join(extension, 'out', 'extension.js'))) {
  throw new Error('the extension is not built: run `pnpm build` in the repository first');
}

const run = realpathSync(mkdtempSync(join(tmpdir(), 'lace-host-e2e-')));
process.on('exit', () => rmSync(run, { recursive: true, force: true }));
const home = join(run, 'home');
mkdirSync(home);

// A fresh git repository `name` under the run's directory, whose settings
// name the engine.
function repository(name) {
  const workspace = join(run, name);
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
  return workspace;
}

// The suites bundled under `out/<suite>/`, in a window on `workspace`.
// VS Code's own state for the window is in the run's directory, under the
// suite's name: a short path, since a socket is made in it, and nothing
// kept from one run to the next.
function window(label, suite, workspace) {
  return {
    label,
    files: `out/${suite}/**/*.test.js`,
    version: 'stable',
    extensionDevelopmentPath: extension,
    workspaceFolder: workspace,
    launchArgs: [
      '--disable-extensions',
      '--disable-workspace-trust',
      `--user-data-dir=${join(run, suite)}`,
    ],
    env: { ...signedOutEnvironment(home), LACE_E2E_ENGINE: engine },
    mocha: { ui: 'bdd', timeout: 120_000, reporter: 'spec' },
  };
}

export default defineConfig([
  window('window', 'window', repository('workspace')),
  window('empty workspace', 'empty', repository('empty-workspace')),
]);
