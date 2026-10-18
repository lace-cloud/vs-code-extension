// A test's engine reads none of the developer's own state. Whatever the
// shell that runs the tests holds when they start (a key and the server it
// is for, a selected organization or team, a tool binary of the developer's
// own, a cache directory), the engine of a test is signed out, selects
// nothing, runs the tools the CLI pins and keeps its caches in the test's
// home.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commandOutcome } from '../command-outcome';
import { moduleDirectory, realEngine } from './real-engine';

// The developer's Lace server, which is also the proxy the shell names for
// every other server. It records each request as `<method> <target>`,
// answers one sent to it as the developer's `/me`, and refuses a tunnel.
const requests: string[] = [];
const server = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      user: { id: 'usr_developer', email: 'developer@example.com', name: 'Developer' },
    }),
  );
});
server.on('connect', (request, socket) => {
  requests.push(`${request.method} ${request.url}`);
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
});
let serverUrl = '';
// The directory the developer's own state is made in.
let developer = '';

beforeAll(async () => {
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  developer = realpathSync(mkdtempSync(join(tmpdir(), 'lace-developer-')));
});
afterAll(async () => {
  rmSync(developer, { recursive: true, force: true });
  await new Promise((closed) => server.close(closed));
});

// The suite's tests run in a shell that holds `shell` (a name whose value
// is undefined unset) when they start.
function inShell(shell: () => Record<string, string | undefined>): void {
  beforeAll(() => {
    for (const [name, value] of Object.entries(shell())) vi.stubEnv(name, value);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
}

// `directory`, holding the key `lace login` saved for the Lace server.
function savedKey(directory: string): string {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'credentials.json'),
    JSON.stringify({ api_key: 'lace_developer', server: 'https://lace.cloud' }),
  );
  return directory;
}

const KEYS: [string, () => Record<string, string>][] = [
  [
    'LACE_TOKEN, for the server LACE_AUTH_URL names',
    () => ({ LACE_TOKEN: 'lace_developer', LACE_AUTH_URL: serverUrl }),
  ],
  [
    'their home',
    () => {
      const home = join(developer, 'home');
      savedKey(join(home, '.config', 'lace'));
      return { HOME: home, USERPROFILE: home };
    },
  ],
  ['their LACE_CONFIG_DIR', () => ({ LACE_CONFIG_DIR: savedKey(join(developer, 'config')) })],
];

describe.each(KEYS)('a developer whose key is in %s', (_where, shell) => {
  inShell(() => ({
    ...shell(),
    HTTPS_PROXY: serverUrl,
    HTTP_PROXY: serverUrl,
    NO_PROXY: undefined,
    no_proxy: undefined,
  }));
  afterAll(() => {
    requests.length = 0;
  });

  test("a test's engine answers whoami unauthenticated, and sends no request", async () => {
    const { commands } = realEngine();
    const outcome = await commandOutcome(await commands.anywhere(), 'whoami', {});
    expect(outcome).toMatchObject({ kind: 'failure', failure: { reason: 'unauthenticated' } });
    expect(requests).toEqual([]);
  });
});

const SELECTIONS: [string, 'org current' | 'team current', Record<string, string>][] = [
  ['an organization in LACE_ORGANIZATION', 'org current', { LACE_ORGANIZATION: 'developer-org' }],
  ['a team in LACE_TEAM', 'team current', { LACE_TEAM: 'developer-team' }],
];

describe.each(SELECTIONS)('a developer who selects %s', (_what, path, shell) => {
  inShell(() => shell);

  test(`a test's engine answers ${path} with none`, async () => {
    const { commands } = realEngine();
    const outcome = await commandOutcome(await commands.anywhere(), path, {});
    expect(outcome).toMatchObject({ kind: 'result', document: { slug: null, source: null } });
  });
});

const TOOLS: [string, 'module fmt' | 'module scan'][] = [
  ['LACE_TERRAFORM_BIN', 'module fmt'],
  ['LACE_TFSEC_BIN', 'module scan'],
];

describe.each(TOOLS)('a developer whose %s names a binary of their own', (name, path) => {
  inShell(() => ({ [name]: join(developer, 'bin', 'missing') }));

  test(`a test's engine runs ${path} with the tool the CLI pins`, async () => {
    const { root } = moduleDirectory();
    const { commands } = realEngine();
    const outcome = await commandOutcome(await commands.at(root), path, {});
    expect(outcome).toMatchObject({ kind: 'result' });
  });
});

describe('a developer whose caches are under XDG_CACHE_HOME', () => {
  const cache = () => join(developer, 'cache');
  inShell(() => ({ XDG_CACHE_HOME: cache() }));

  test("a test's engine validates a module, and keeps nothing there", async () => {
    const { root } = moduleDirectory();
    const { commands } = realEngine();
    const outcome = await commandOutcome(await commands.at(root), 'module validate', {});
    expect(outcome).toMatchObject({ kind: 'result' });
    expect(existsSync(cache())).toBe(false);
  });
});
