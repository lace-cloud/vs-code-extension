// The engine the extension's engine tests and window e2e run: the released
// `lace` CLI at the version `LACE_CLI_VERSION` names. It is the binary a run
// names, else `bin/lace` when one is there, else the `lace` on PATH; and
// whichever it is, it says that version (`lace version -o json`) or it is
// refused, so a test passes only against the CLI a developer installs from
// its releases, never against another build.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const NAME = process.platform === 'win32' ? 'lace.exe' : 'lace';

// The release `LACE_CLI_VERSION` names: the file without its comment lines
// and whitespace, as CI reads it.
function pinnedVersion(repository) {
  return readFileSync(join(repository, 'LACE_CLI_VERSION'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('')
    .replace(/\s/g, '');
}

function placedOrOnPath(repository) {
  const directories = (process.env.PATH ?? '').split(delimiter).filter((d) => d !== '');
  return [join(repository, 'bin'), ...directories]
    .map((directory) => join(directory, NAME))
    .find((binary) => existsSync(binary));
}

const versionOf = (binary) =>
  JSON.parse(execFileSync(binary, ['version', '-o', 'json'], { encoding: 'utf8' })).version;

export function releasedEngine(repository, named) {
  const pinned = pinnedVersion(repository);
  const binary = named ?? placedOrOnPath(repository);
  const install = `install it with: curl -fsSL https://releases.lace.cloud/install.sh | sh -s -- --version ${pinned} --install-dir ${join(repository, 'bin')}`;
  if (binary === undefined || !existsSync(binary)) {
    const where = named ?? `${join(repository, 'bin', NAME)} or on PATH`;
    return {
      refusal: `no engine at ${where}: the tests run the lace CLI ${pinned} that LACE_CLI_VERSION names; ${install}`,
    };
  }
  const version = versionOf(binary);
  if (version !== pinned) {
    return {
      refusal: `${binary} is lace ${version}, and the tests run only the lace CLI ${pinned} that LACE_CLI_VERSION names; ${install}`,
    };
  }
  return { binary };
}
