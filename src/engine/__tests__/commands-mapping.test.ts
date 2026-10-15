import { describe, expect, test } from 'vitest';
import { createCommandsMapping } from '../commands-mapping';
import { fakeEngine } from './fake-engine';

async function run(events: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of events) {
    // A command's documents; these tests read what was sent.
  }
}

describe('the commands mapping', () => {
  test('a command that reads a module runs in the authoring root it was asked for', async () => {
    const engine = fakeEngine();
    const commands = await createCommandsMapping(
      { caller: async () => engine.caller },
      '/home/dev',
    ).at('/repo/infra/prod');
    await run(commands.invoke('module fmt', {}, new AbortController().signal).events);

    const [invoke] = engine.sent.filter((s) => s.method === 'Invoke');
    expect(invoke.request).toMatchObject({
      path: ['module', 'fmt'],
      workingDirectory: '/repo/infra/prod',
    });
    expect(invoke.request).not.toHaveProperty('sessionId');
  });

  test("a command that reads no directory runs in the developer's home", async () => {
    const engine = fakeEngine();
    const commands = await createCommandsMapping(
      { caller: async () => engine.caller },
      '/home/dev',
    ).anywhere();
    await run(commands.invoke('whoami', {}, new AbortController().signal).events);

    const [invoke] = engine.sent.filter((s) => s.method === 'Invoke');
    expect(invoke.request).toMatchObject({ path: ['whoami'], workingDirectory: '/home/dev' });
  });

  test("the engine's Invoke stream says the command started before it says how it exited", async () => {
    const engine = fakeEngine();
    const events: Record<string, unknown>[] = [];
    for await (const event of engine.caller.stream(
      'Invoke',
      { path: ['whoami'], working_directory: '/home/dev' },
      new AbortController().signal,
    )) {
      events.push(event as Record<string, unknown>);
    }

    const said = events.map((event) =>
      Object.keys(event).filter((key) => event[key] !== undefined),
    );
    expect(said).toEqual([['started'], ['exit']]);
  });

  test('opens no session and no stream of session state', async () => {
    const engine = fakeEngine();
    const mapping = createCommandsMapping({ caller: async () => engine.caller }, '/home/dev');
    await mapping.at('/repo/infra/prod');
    await mapping.anywhere();

    expect(engine.sent.map((s) => s.method)).toEqual(['Initialize', 'Initialize']);
    expect(engine.open()).toEqual([]);
  });

  test('hands back the port it opened while the same engine runs, and a new one over a new engine', async () => {
    const window = { engine: fakeEngine() };
    const mapping = createCommandsMapping(
      { caller: async () => window.engine.caller },
      '/home/dev',
    );
    const first = await mapping.anywhere();
    expect(await mapping.anywhere()).toBe(first);
    expect(await mapping.at('/repo/infra/prod')).not.toBe(first);
    expect(window.engine.count('Initialize')).toBe(2);

    window.engine = fakeEngine();
    expect(await mapping.anywhere()).not.toBe(first);
  });

  test('a port the engine refused is asked for again', async () => {
    const engine = fakeEngine();
    engine.refuse('Initialize', 'REASON_UNSPECIFIED');
    const mapping = createCommandsMapping({ caller: async () => engine.caller }, '/home/dev');
    await expect(mapping.anywhere()).rejects.toThrow();
    await expect(mapping.anywhere()).rejects.toThrow();
    expect(engine.count('Initialize')).toBe(2);
  });
});
