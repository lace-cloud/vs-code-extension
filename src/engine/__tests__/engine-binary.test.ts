// The engine the engine tests and the window e2e run is the released CLI
// LACE_CLI_VERSION names, and nothing else: a binary that says another
// version is refused, whichever way it was found.
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
// and refuses any other arguments.
function lace(path: string, version: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(
    path,
    `#!/bin/sh\n[ "$*" = "version -o json" ] || exit 2\nprintf '{"version": "${version}"}\\n'\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe('the engine the tests run', () => {
  test('is the bin/lace of the version LACE_CLI_VERSION names', () => {
    const repo = repository();
    const binary = lace(join(repo, 'bin', 'lace'), 'v2.40.0');
    expect(releasedEngine(repo)).toEqual({ binary });
  });

  test('a build that says another version is refused, naming both versions', () => {
    const repo = repository();
    lace(join(repo, 'bin', 'lace'), 'dev');
    const engine = releasedEngine(repo);
    expect(engine).not.toHaveProperty('binary');
    expect(engine).toMatchObject({ refusal: expect.stringContaining('is lace dev') });
    expect(engine).toMatchObject({ refusal: expect.stringContaining('v2.40.0') });
  });

  test('a binary a run names is held to the same version', () => {
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
