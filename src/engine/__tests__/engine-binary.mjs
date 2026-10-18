// The engine the extension's engine tests and window e2e run, and the
// developer it runs for. The engine is the released `lace` CLI at the
// version `LACE_CLI_VERSION` names. It is the binary a run names, else
// `bin/lace` (`bin/lace.exe` on Windows) when one is there, else the one on
// PATH; and whichever it is, it says that version (`lace version -o json`)
// or it is refused, naming the way to install that release on the
// developer's OS, so a test passes only against the CLI a developer installs
// from its releases, never against another build. The developer is signed
// out, in a home holding nothing, whatever the shell that runs the tests
// holds (`signedOutEnvironment`).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const nameOn = (platform) => (platform === 'win32' ? 'lace.exe' : 'lace');

// The installer refuses Windows. There, Scoop installs the newest release
// only, and the release's own `.exe` is the one at any version.
function installOn(platform, pinned, bin) {
  if (platform === 'win32') {
    return `install it with: scoop install https://releases.lace.cloud/lace.json, while ${pinned} is the newest release; or save https://releases.lace.cloud/lace-cli-windows-amd64-${pinned}.exe (checked against its .sha256) as ${join(bin, 'lace.exe')}`;
  }
  return `install it with: curl -fsSL https://releases.lace.cloud/install.sh | sh -s -- --version ${pinned} --install-dir ${bin}`;
}

// The release `LACE_CLI_VERSION` names: the file without its comment lines
// and whitespace, as CI reads it.
export function pinnedVersion(repository) {
  return readFileSync(join(repository, 'LACE_CLI_VERSION'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('')
    .replace(/\s/g, '');
}

function placedOrOnPath(repository, name) {
  const directories = (process.env.PATH ?? '').split(delimiter).filter((d) => d !== '');
  return [join(repository, 'bin'), ...directories]
    .map((directory) => join(directory, name))
    .find((binary) => existsSync(binary));
}

const versionOf = (binary) =>
  JSON.parse(execFileSync(binary, ['version', '-o', 'json'], { encoding: 'utf8' })).version;

export function releasedEngine(repository, named, platform = process.platform) {
  const pinned = pinnedVersion(repository);
  const name = nameOn(platform);
  const binary = named ?? placedOrOnPath(repository, name);
  const install = installOn(platform, pinned, join(repository, 'bin'));
  if (binary === undefined || !existsSync(binary)) {
    const where = named ?? `${join(repository, 'bin', name)} or on PATH`;
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

// The variables the CLI reads a developer's own state from: the home (HOME,
// and USERPROFILE on Windows), under which `lace login` saves the key, `lace
// org use` and `lace team use` the selection, and the CLI keeps the pinned
// tools it downloads; the directory that replaces the home's for the key and
// the selection; the machine credential; the Lace server; the organization
// and team; the directory the CLI caches provider plugins, module archives
// and authoring workspaces under; and, for each tool the CLI pins, a binary
// of the developer's own, which it runs without checking the pin.
export const DEVELOPER_STATE_ENV = [
  'HOME',
  'USERPROFILE',
  'LACE_CONFIG_DIR',
  'LACE_TOKEN',
  'LACE_AUTH_URL',
  'LACE_ORGANIZATION',
  'LACE_TEAM',
  'XDG_CACHE_HOME',
  'LACE_TERRAFORM_BIN',
  'LACE_TFSEC_BIN',
];

const HOME_ENV = ['HOME', 'USERPROFILE'];

// The environment of a developer whose home is `home`, a directory that
// holds nothing: every name in DEVELOPER_STATE_ENV unset (undefined) but the
// home's, which name `home` on every OS. The developer is signed out, with no
// saved selection and no tool of their own.
export function signedOutEnvironment(home) {
  return Object.fromEntries(
    DEVELOPER_STATE_ENV.map((name) => [name, HOME_ENV.includes(name) ? home : undefined]),
  );
}
