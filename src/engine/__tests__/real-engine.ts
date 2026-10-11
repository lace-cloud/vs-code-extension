// The real engine, the released `lace` CLI of `LACE_CLI_VERSION` in bin/ or
// on PATH, and no other build (`engine-binary.mjs`), and what the tests of
// the `engine` project build around it: module directories in a git
// repository, a developer signed out, and an engine as one window has it.
// Each test's resources are undone after it, the latest first.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll } from 'vitest';
import { type CommandsMapping, createCommandsMapping } from '../commands-mapping';
import { createEngine, type Engine, engineManager } from '../engine';
import { createRootSessions, type RootSessions, type SessionObserver } from '../root-sessions';
import { releasedEngine } from './engine-binary.mjs';

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

// The environment that names the developer's credentials and selection.
const ACCOUNT = ['HOME', 'LACE_CONFIG_DIR', 'LACE_API_KEY', 'LACE_ORGANIZATION', 'LACE_TEAM'];

// A developer with no credentials and no saved selection, in a home of the
// test's own: an engine started after this reads that home. Resolves with
// the home.
export function signedOutHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'lace-home-')));
  const saved = Object.fromEntries(ACCOUNT.map((name) => [name, process.env[name]]));
  for (const name of ACCOUNT) delete process.env[name];
  process.env.HOME = home;
  afterTest(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}

export type RealEngineOptions = {
  binaryPath?: string;
  autoRestart?: boolean;
  // The directory a command that reads none runs in.
  home?: string;
  observer?: SessionObserver;
};

// An engine as one window has it, with its root sessions, `observer`
// attached to them, and its commands mapping; stopped after the test.
export function realEngine(options: RealEngineOptions = {}): {
  engine: Engine;
  rootSessions: RootSessions;
  commands: CommandsMapping;
  reports: unknown[];
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
  const commands = createCommandsMapping(engine, options.home);
  return { engine, rootSessions, commands, reports };
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
