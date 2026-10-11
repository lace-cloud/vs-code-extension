// What git tracks keeps the published form: every `@lace-cloud/*`
// dependency is a version published on npm, and nothing redirects one — no
// local path, link or override in a manifest, the workspace file or the
// lockfile, and no pnpmfile or second lockfile. The lockfile locks exactly
// what the manifests name, so what CI installs (`--frozen-lockfile`, which
// refuses any other lockfile) is what they pin. It reads the index, never
// the working tree.
import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

type Tracked = ReadonlyMap<string, string>;

// The dependencies an install resolves, each an importer's group in the
// lockfile.
const INSTALLED_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const DEPENDENCY_FIELDS = [...INSTALLED_FIELDS, 'peerDependencies'] as const;
const REDIRECTING_FILES = ['.pnpmfile.cjs'];
const LOCAL_SPEC = /^(file|link|portal):/;
// A workspace package is `specifier: workspace:*` with `version: link:<dir>`;
// that is not a redirect.
const LOCKFILE_REDIRECT = /^(overrides|pnpmfileChecksum):|specifier: (file|link):|: file:/m;

function manifestViolations(path: string, text: string): string[] {
  const manifest = JSON.parse(text);
  const found: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, spec] of Object.entries<string>(manifest[field] ?? {})) {
      if (LOCAL_SPEC.test(spec)) found.push(`${path}: ${field}.${name} is ${spec}`);
    }
  }
  for (const key of ['overrides', 'resolutions']) {
    if (key in manifest) found.push(`${path}: ${key}`);
  }
  if (manifest.pnpm && 'overrides' in manifest.pnpm) found.push(`${path}: pnpm.overrides`);
  return found;
}

function pinViolations(tracked: Tracked): string[] {
  const found: string[] = [];
  for (const [path, text] of tracked) {
    const name = path.split('/').pop();
    if (name === 'package.json') found.push(...manifestViolations(path, text));
    if (name === 'pnpm-workspace.yaml' && /^overrides:/m.test(text)) {
      found.push(`${path}: overrides`);
    }
    if (name === 'pnpm-lock.yaml' && LOCKFILE_REDIRECT.test(text)) {
      found.push(`${path}: a local reference or an override`);
    }
    if (REDIRECTING_FILES.includes(path) || /^pnpm-lock\..+\.yaml$/.test(path)) {
      found.push(`${path}: a pnpmfile or a second lockfile is tracked`);
    }
  }
  return found;
}

const unquote = (text: string): string => text.replace(/^'(.*)'$/, '$1');

// What each importer of a lockfile (`.`, and each workspace package's
// directory) locks, as `field name specifier` lines.
function lockedImporters(lockfile: string): Map<string, string[]> {
  const section = lockfile.split(/^importers:$/m)[1]?.split(/^\S/m)[0] ?? '';
  const importers = new Map<string, string[]>();
  let locked: string[] = [];
  let field = '';
  let name = '';
  for (const line of section.split('\n')) {
    const [, indent, key, value] = line.match(/^( +)('[^']*'|[^':][^:]*):(?: (.+))?$/) ?? [];
    if (indent?.length === 2) {
      locked = [];
      importers.set(unquote(key), locked);
    }
    if (indent?.length === 4) field = key;
    if (indent?.length === 6) name = unquote(key);
    if (indent?.length === 8 && key === 'specifier') {
      locked.push(`${field} ${name} ${unquote(value)}`);
    }
  }
  return importers;
}

// What each tracked manifest names, by its directory (`.` for the root), as
// the same lines.
function namedImporters(tracked: Tracked): Map<string, string[]> {
  return new Map(
    [...tracked]
      .filter(([path]) => path.split('/').pop() === 'package.json')
      .map(([path, text]): [string, string[]] => {
        const manifest = JSON.parse(text);
        const importer = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
        return [
          importer,
          INSTALLED_FIELDS.flatMap((field) =>
            Object.entries<string>(manifest[field] ?? {}).map(
              ([name, spec]) => `${field} ${name} ${spec}`,
            ),
          ),
        ];
      }),
  );
}

// Where the tracked lockfile and the tracked manifests disagree: a
// dependency one names and the other does not, at that specifier, or an
// importer one has and the other does not.
function lockfileDisagreements(tracked: Tracked): string[] {
  const locked = lockedImporters(tracked.get('pnpm-lock.yaml') ?? '');
  const named = namedImporters(tracked);
  return [...new Set([...locked.keys(), ...named.keys()])].sort().flatMap((importer) => {
    const lockedLines = locked.get(importer) ?? [];
    const namedLines = named.get(importer) ?? [];
    return [
      ...lockedLines
        .filter((line) => !namedLines.includes(line))
        .map((line) => `${importer}: the lockfile locks ${line}, which no manifest names`),
      ...namedLines
        .filter((line) => !lockedLines.includes(line))
        .map((line) => `${importer}: the manifest names ${line}, which the lockfile does not lock`),
    ];
  });
}

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' });

function trackedFiles(): Tracked {
  const paths = git(
    'ls-files',
    '-z',
    '--',
    'package.json',
    '**/package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock*.yaml',
    ...REDIRECTING_FILES,
  )
    .split('\0')
    .filter((path) => path !== '');
  return new Map(paths.map((path) => [path, git('show', `:${path}`)]));
}

const MANIFEST = JSON.stringify({ dependencies: { '@lace-cloud/canvas': '0.17.0' } });

describe('tracked dependency pins', () => {
  test('what git tracks names no local path, link or override', () => {
    const tracked = trackedFiles();
    expect([...tracked.keys()]).toContain('package.json');
    expect(pinViolations(tracked)).toEqual([]);
  });

  test('a released version passes', () => {
    expect(pinViolations(new Map([['package.json', MANIFEST]]))).toEqual([]);
  });

  test.each([
    ['a local file dependency', { dependencies: { '@lace-cloud/canvas': 'file:../canvas.tgz' } }],
    ['a linked dependency', { devDependencies: { '@lace-cloud/host': 'link:../host' } }],
    ['an override', { pnpm: { overrides: { '@lace-cloud/proto': '0.17.0' } } }],
    ['a top-level override', { overrides: { '@lace-cloud/proto': '0.17.0' } }],
  ])('%s in a manifest is a violation', (_name, manifest) => {
    for (const path of ['package.json', 'packages/host-e2e/package.json']) {
      expect(pinViolations(new Map([[path, JSON.stringify(manifest)]]))).toHaveLength(1);
    }
  });

  test('an override in the workspace file is a violation', () => {
    const workspace = 'packages:\n  - "packages/*"\noverrides:\n  "@lace-cloud/ui": 0.17.0\n';
    expect(pinViolations(new Map([['pnpm-workspace.yaml', workspace]]))).toHaveLength(1);
  });

  test.each([
    ['a local specifier', "      '@lace-cloud/canvas':\n        specifier: file:/x/canvas.tgz\n"],
    ['a local version', "      '@lace-cloud/canvas':\n        version: file:../canvas.tgz\n"],
    ['a pnpmfile checksum', 'pnpmfileChecksum: sha256-x\n'],
    ['an override', "overrides:\n  '@lace-cloud/ui': 0.17.0\n"],
  ])('%s in the lockfile is a violation', (_name, lockfile) => {
    expect(pinViolations(new Map([['pnpm-lock.yaml', lockfile]]))).toHaveLength(1);
  });

  test.each(['.pnpmfile.cjs', 'pnpm-lock.feat!x.yaml'])('%s tracked is a violation', (path) => {
    expect(pinViolations(new Map([[path, '']]))).toHaveLength(1);
  });
});

// A lockfile of two importers, the root and `packages/e2e`.
const LOCKFILE = [
  "lockfileVersion: '9.0'",
  '',
  'importers:',
  '',
  '  .:',
  '    dependencies:',
  "      '@lace-cloud/canvas':",
  '        specifier: 0.17.0',
  '        version: 0.17.0(@types/react@18.3.28)',
  '    devDependencies:',
  '      vitest:',
  '        specifier: ^3.2.4',
  '        version: 3.2.7',
  '',
  '  packages/e2e:',
  '    devDependencies:',
  '      mocha:',
  '        specifier: ^12.0.3',
  '        version: 12.0.3',
  '',
  'packages:',
  '',
  "  '@lace-cloud/canvas@0.17.0':",
  '    resolution: {integrity: sha512-x}',
  '',
].join('\n');

const ROOT_MANIFEST = {
  dependencies: { '@lace-cloud/canvas': '0.17.0' },
  devDependencies: { vitest: '^3.2.4' },
  peerDependencies: { react: '^18' },
};
const E2E_MANIFEST = { devDependencies: { mocha: '^12.0.3' } };

const tracking = (root: object, e2e?: object): Tracked =>
  new Map([
    ['package.json', JSON.stringify(root)],
    ...(e2e ? [['packages/e2e/package.json', JSON.stringify(e2e)] as const] : []),
    ['pnpm-lock.yaml', LOCKFILE],
  ]);

describe('the tracked lockfile', () => {
  test('locks exactly what each tracked manifest names', () => {
    expect(lockfileDisagreements(trackedFiles())).toEqual([]);
  });

  test('agrees with manifests that name what it locks', () => {
    expect(lockfileDisagreements(tracking(ROOT_MANIFEST, E2E_MANIFEST))).toEqual([]);
  });

  test('disagrees with a manifest whose specifier moved', () => {
    const moved = { ...ROOT_MANIFEST, devDependencies: { vitest: '^3.3.0' } };
    expect(lockfileDisagreements(tracking(moved, E2E_MANIFEST))).toEqual([
      '.: the lockfile locks devDependencies vitest ^3.2.4, which no manifest names',
      '.: the manifest names devDependencies vitest ^3.3.0, which the lockfile does not lock',
    ]);
  });

  test('disagrees with a manifest that names a dependency it does not lock', () => {
    const added = {
      ...ROOT_MANIFEST,
      dependencies: { ...ROOT_MANIFEST.dependencies, react: '18' },
    };
    expect(lockfileDisagreements(tracking(added, E2E_MANIFEST))).toEqual([
      '.: the manifest names dependencies react 18, which the lockfile does not lock',
    ]);
  });

  test('disagrees when it locks a workspace package that has no manifest', () => {
    expect(lockfileDisagreements(tracking(ROOT_MANIFEST))).toEqual([
      'packages/e2e: the lockfile locks devDependencies mocha ^12.0.3, which no manifest names',
    ]);
  });
});
