// The engine the engine tests and the window e2e run is the released CLI
// LACE_CLI_VERSION names, and nothing else: a binary that says another
// version is refused, whichever way it was found, and a refusal names the
// way to install that release on the developer's OS.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { releasedEngine } from './engine-binary.mjs';

const made: string[] = [];
afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// A repository whose LACE_CLI_VERSION pins v2.40.0, under a comment line.
function repository(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'lace-engine-binary-')));
  made.push(directory);
  writeFileSync(join(directory, 'LACE_CLI_VERSION'), '# The released CLI.\nv2.40.0\n');
  return directory;
}

// A `lace` at `path` that answers `lace version -o json` with `version`,
// and refuses any other arguments. It is a POSIX shell script, which Windows
// does not execute: a test that runs one is a `withShellScript` test.
function lace(path: string, version: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(
    path,
    `#!/bin/sh\n[ "$*" = "version -o json" ] || exit 2\nprintf '{"version": "${version}"}\\n'\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

const withShellScript = test.runIf(process.platform !== 'win32');

describe('the engine the tests run', () => {
  withShellScript('is the bin/lace of the version LACE_CLI_VERSION names', () => {
    const repo = repository();
    const binary = lace(join(repo, 'bin', 'lace'), 'v2.40.0');
    expect(releasedEngine(repo)).toEqual({ binary });
  });

  withShellScript('a build that says another version is refused, naming both versions', () => {
    const repo = repository();
    lace(join(repo, 'bin', 'lace'), 'dev');
    const engine = releasedEngine(repo);
    expect(engine).not.toHaveProperty('binary');
    expect(engine).toMatchObject({ refusal: expect.stringContaining('is lace dev') });
    expect(engine).toMatchObject({ refusal: expect.stringContaining('v2.40.0') });
  });

  withShellScript('a binary a run names is held to the same version', () => {
    const repo = repository();
    lace(join(repo, 'bin', 'lace'), 'v2.40.0');
    const older = lace(join(repo, 'elsewhere', 'lace'), 'v2.38.0');
    expect(releasedEngine(repo, older)).toMatchObject({
      refusal: expect.stringContaining('is lace v2.38.0'),
    });
    const pinned = lace(join(repo, 'pinned', 'lace'), 'v2.40.0');
    expect(releasedEngine(repo, pinned)).toEqual({ binary: pinned });
  });

  test('a named binary that is not there is no engine', () => {
    const repo = repository();
    const missing = join(repo, 'nowhere', 'lace');
    expect(releasedEngine(repo, missing)).toMatchObject({
      refusal: expect.stringContaining(`no engine at ${missing}`),
    });
  });
});

describe('the install a refusal names', () => {
  test('on Windows is Scoop or the release .exe, at the version LACE_CLI_VERSION names, never the installer', () => {
    const repo = repository();
    const engine = releasedEngine(repo, join(repo, 'nowhere', 'lace.exe'), 'win32');
    expect(engine).toMatchObject({
      refusal: expect.stringContaining(
        'scoop install https://releases.lace.cloud/lace.json, while v2.40.0 is the newest release',
      ),
    });
    expect(engine).toMatchObject({
      refusal: expect.stringContaining(
        `https://releases.lace.cloud/lace-cli-windows-amd64-v2.40.0.exe (checked against its .sha256) as ${join(repo, 'bin', 'lace.exe')}`,
      ),
    });
    expect(engine).toMatchObject({ refusal: expect.not.stringContaining('install.sh') });
  });

  test('on every other OS is the installer, at the version LACE_CLI_VERSION names', () => {
    const repo = repository();
    const engine = releasedEngine(repo, join(repo, 'nowhere', 'lace'), 'linux');
    expect(engine).toMatchObject({
      refusal: expect.stringContaining(
        `curl -fsSL https://releases.lace.cloud/install.sh | sh -s -- --version v2.40.0 --install-dir ${join(repo, 'bin')}`,
      ),
    });
    expect(engine).toMatchObject({ refusal: expect.not.stringContaining('scoop') });
  });
});
