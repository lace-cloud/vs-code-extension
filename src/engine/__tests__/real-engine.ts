// The real engine, the released `lace` CLI of `LACE_CLI_VERSION` in bin/ or
// on PATH, and no other build (`engine-binary.mjs`), and what the tests of
// the `engine` project build around it: module directories in a git
// repository, a developer of each test's own, signed out, and an engine as
// one window has it. Each test's resources are undone after it, the latest
// first.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach } from 'vitest';
import { type CommandsMapping, createCommandsMapping } from '../commands-mapping';
import { createEngine, type Engine, engineManager } from '../engine';
import { createRootSessions, type RootSessions, type SessionObserver } from '../root-sessions';
import { DEVELOPER_STATE_ENV, releasedEngine, signedOutEnvironment } from './engine-binary.mjs';

const ROOT = resolve(__dirname, '..', '..', '..');
const ENGINE = releasedEngine(ROOT);
export const BINARY = 'binary' in ENGINE ? ENGINE.binary : join(ROOT, 'bin', 'lace');

beforeAll(() => {
  if ('refusal' in ENGINE) throw new Error(ENGINE.refusal);
});

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// `cleanup` runs after the test, before what was registered earlier.
export function afterTest(cleanup: () => Promise<void> | void): void {
  cleanups.push(cleanup);
}

// Sets each of `values` in this process's environment, unsetting a name
// whose value is undefined.
function setEnvironment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

// Each test runs for a developer of its own: signed out, with no saved
// selection and no tool of their own, in a home of the test's own
// (`signedOutEnvironment`). Every process the test starts inherits it, each
// engine, any host that starts one and git, so none reads the state of the
// developer who runs the tests. The home holds the tools and caches the
// engine keeps there, which Windows can hold open for a moment after the
// process that wrote them ends, so its removal retries.
let home = '';
beforeEach(() => {
  const shell = Object.fromEntries(DEVELOPER_STATE_ENV.map((name) => [name, process.env[name]]));
  const own = realpathSync(mkdtempSync(join(tmpdir(), 'lace-home-')));
  home = own;
  setEnvironment(signedOutEnvironment(own));
  afterTest(() => {
    setEnvironment(shell);
    rmSync(own, { recursive: true, force: true, maxRetries: 10 });
  });
});

// A module of one variable, in Lace form.
export const MODULE = 'variable "name" {\n  type = string\n}\n';

// A directory of its own, in no git repository.
export function scratchDirectory(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'lace-extension-')));
  afterTest(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// A git repository of its own, as an authoring root is in.
export function gitRepository(): string {
  const repository = scratchDirectory();
  execFileSync('git', ['init', '--quiet', repository]);
  return repository;
}

// The module directory `name` in `repository`, whose files are `files`
// (name → content).
export function moduleIn(
  repository: string,
  name: string,
  files: Record<string, string> = { 'main.tf': MODULE },
): string {
  const root = join(repository, name);
  mkdirSync(root);
  for (const [file, content] of Object.entries(files)) writeFileSync(join(root, file), content);
  return root;
}

// A git repository holding one module directory, `infra`.
export function moduleDirectory(files?: Record<string, string>): {
  repository: string;
  root: string;
} {
  const repository = gitRepository();
  return { repository, root: moduleIn(repository, 'infra', files) };
}

export type RealEngineOptions = {
  binaryPath?: string;
  autoRestart?: boolean;
  observer?: SessionObserver;
};

// An engine as one window has it, for the test's developer: its root
// sessions, `observer` attached to them, its commands mapping, whose
// commands that read no directory run in the developer's `home`, and that
// home; stopped after the test. Two engines of one test are two windows of
// one developer.
export function realEngine(options: RealEngineOptions = {}): {
  engine: Engine;
  rootSessions: RootSessions;
  commands: CommandsMapping;
  reports: unknown[];
  home: string;
} {
  const settings = {
    binaryPath: () => options.binaryPath ?? BINARY,
    autoRestart: () => options.autoRestart ?? false,
  };
  const engine = createEngine(
    engineManager(settings, () => {}),
    settings,
  );
  const reports: unknown[] = [];
  const rootSessions = createRootSessions({
    engine,
    report: (_what, error) => reports.push(error),
  });
  if (options.observer) rootSessions.observe(options.observer);
  afterTest(async () => {
    await rootSessions.dispose();
    await engine.stop();
  });
  const commands = createCommandsMapping(engine, home);
  return { engine, rootSessions, commands, reports, home };
}

// Waits until `holds` is true, polling; resolves with how long that took.
export async function until(
  what: string,
  holds: () => boolean,
  withinMs = 10_000,
): Promise<number> {
  const started = Date.now();
  while (!holds()) {
    if (Date.now() - started > withinMs) {
      throw new Error(`${what} did not happen in ${withinMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return Date.now() - started;
}
