const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Run on macOS after building the extension with matching local libraries.
// LACE_HOT_MODE=graceful checks orderly quit; delayed checks SIGKILL after
// 65 seconds; immediate checks the crash window before storage flush.
// Select Restore in the isolated window when prompted.
const engine = process.env.LACE_DEVELOPMENT_ENGINE;
const mode = process.env.LACE_HOT_MODE || 'graceful';
if (!['graceful', 'delayed', 'immediate'].includes(mode)) throw Error('Invalid LACE_HOT_MODE.');
if (!engine) throw Error('Set LACE_DEVELOPMENT_ENGINE to the locally built CLI.');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-vscode-hot-'));
const workspace = path.join(dir, 'workspace');
fs.mkdirSync(path.join(workspace, 'module'), { recursive: true });
fs.mkdirSync(path.join(workspace, '.vscode'));
execFileSync('git', ['init', '--quiet', workspace]);
fs.writeFileSync(
  path.join(workspace, 'module', 'main.tf'),
  'variable "name" {\n type = string\n}\n',
);
fs.writeFileSync(
  path.join(workspace, '.vscode', 'settings.json'),
  JSON.stringify({
    'lace.binaryPath': engine,
    'git.enabled': false,
    'workbench.startupEditor': 'none',
    'files.autoSave': 'off',
  }),
);
fs.mkdirSync(path.join(dir, 'extensions', 'hot.harness'), { recursive: true });
fs.copyFileSync(
  path.join(__dirname, 'extension.cjs'),
  path.join(dir, 'extensions', 'hot.harness', 'extension.js'),
);
fs.writeFileSync(
  path.join(dir, 'extensions', 'hot.harness', 'package.json'),
  JSON.stringify({
    name: 'harness',
    publisher: 'hot',
    version: '0.0.1',
    engines: { vscode: '^1.96.0' },
    main: './extension.js',
    activationEvents: ['onStartupFinished'],
  }),
);
console.log('isolated run', dir);
const exe =
  process.env.LACE_VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const ext = path.resolve(__dirname, '../../..');
function start(phase) {
  const args = [
    workspace,
    '--use-mock-keychain',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--no-sandbox',
    '--disable-updates',
    `--user-data-dir=${dir}/profile`,
    `--extensions-dir=${dir}/extensions`,
    `--extensionDevelopmentPath=${ext}`,
  ];
  const child = spawn(exe, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: dir,
      LACE_HOT_TEST_DIR: dir,
      LACE_HOT_PHASE: String(phase),
      LACE_HOT_GRACEFUL: mode === 'graceful' ? '1' : '',
    },
  });
  child.on('error', (error) => {
    child.startError = error;
  });
  child.stdout.on('data', (x) => process.stdout.write(x));
  child.stderr.on('data', (x) => process.stderr.write(x));
  return child;
}
async function until(file, child) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (fs.existsSync(path.join(dir, file))) return;
    const err = path.join(dir, `error-${file === 'ready' ? 1 : 2}`);
    if (fs.existsSync(err)) throw Error(fs.readFileSync(err, 'utf8'));
    if (child.startError) throw child.startError;
    if (child.exitCode !== null) throw Error(`VS Code exited ${child.exitCode}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(`timed out waiting for ${file}`);
}
(async () => {
  let c;
  try {
    c = start(1);
    await until('ready', c);
    if (mode === 'graceful') {
      if (c.exitCode === null)
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('VS Code did not quit')), 20000);
          c.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
    } else {
      if (mode === 'delayed') {
        console.log('Waiting 65s for VS Code storage flush.');
        await new Promise((resolve) => setTimeout(resolve, 65000));
      }
      process.kill(-c.pid, 'SIGKILL');
    }
    await new Promise((r) => setTimeout(r, 2000));
    c = start(2);
    await until('phase2-start', c);
    console.log('Select Restore in the isolated VS Code recovery dialog.');
    await until('PASS', c);
    console.log(`PASS: ${mode} recovery`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (c?.pid) {
      try {
        process.kill(-c.pid, 'SIGKILL');
      } catch {}
      if (!c.startError && c.exitCode === null && c.signalCode === null) {
        await new Promise((resolve) => {
          c.once('exit', resolve);
        });
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
