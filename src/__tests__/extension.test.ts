// Deactivation of the extension, over fakes of the owners `extension.ts`
// builds (the engine, the root sessions, the autosave keeper), each logging
// to the "Lace" Output channel while the window closes as the real owners
// do. VS Code calls `deactivate`, then disposes the context's subscriptions
// without waiting for the promise it returned.
import { describe, expect, test, vi } from 'vitest';
import { activate, deactivate } from '../extension';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakes = vi.hoisted(() => {
  // The "Lace" channel as VS Code keeps it: a line appended once it is
  // disposed throws, as VS Code's own channel does.
  const channel = {
    lines: [] as string[],
    disposed: 0,
    appendLine(line: string) {
      if (channel.disposed > 0) throw new Error('Channel has been closed');
      channel.lines.push(line);
    },
    dispose() {
      channel.disposed += 1;
    },
  };
  return {
    channel,
    // The log each owner was handed.
    logs: {} as Record<'engine' | 'autosave', (line: string) => void>,
  };
});

vi.mock('vscode', () => ({
  window: { createOutputChannel: () => fakes.channel },
  workspace: {},
}));

// The engine logs its state's last transition once its process has ended.
vi.mock('../engine/engine', () => ({
  engineSettings: () => ({}),
  engineManager: (_settings: unknown, log: (line: string) => void) => {
    fakes.logs.engine = log;
    return {};
  },
  createEngine: () => ({
    stop: async () => {
      await settled();
      fakes.logs.engine('State: running -> stopped');
    },
  }),
}));

// Disposing the root sessions flushes each one's autosave, which logs the
// save that failed, then reports the close that failed.
vi.mock('../engine/root-sessions', () => ({
  createRootSessions: ({ report }: { report: (what: string, error: unknown) => void }) => ({
    observe: () => ({ dispose: () => {} }),
    dispose: async () => {
      await settled();
      fakes.logs.autosave('Lace could not save the canvas of /work/repo/infra');
      report('closing a session', new Error('the engine ended'));
    },
  }),
}));

vi.mock('../autosave/autosave-policy', () => ({
  createAutosaveKeeper: (_api: unknown, log: (line: string) => void) => {
    fakes.logs.autosave = log;
    return { attach: () => ({ flush: async () => {}, dispose: () => {} }), dispose: () => {} };
  },
}));

vi.mock('../features', () => ({ FEATURES: [], windowHost: () => ({}) }));

describe('deactivation', () => {
  test('the Lace channel takes every line its owners log while the window closes, and is disposed once, after the engine stopped', async () => {
    const context = { subscriptions: [] as { dispose: () => unknown }[] };
    activate(context as never);

    const closing = deactivate();
    for (const subscription of context.subscriptions) subscription.dispose();
    await closing;

    expect(fakes.channel.lines).toEqual([
      'Lace could not save the canvas of /work/repo/infra',
      'closing a session: the engine ended',
      'State: running -> stopped',
    ]);
    expect(fakes.channel.disposed).toBe(1);
  });
});
