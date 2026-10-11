import { ApplyUnobservedError } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import { fakeEngine, settled } from '../../engine/__tests__/fake-engine';
import { createRootSessions } from '../../engine/root-sessions';
import {
  type AutoSaveMode,
  autosavePolicyOf,
  createAutosaveKeeper,
  FLUSH_TRIGGERS,
  readAutoSave,
  saveFailureText,
} from '../autosave-policy';

const configuration = (values: Record<string, unknown>) =>
  ({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  }) as never;

describe('the setting', () => {
  test('each files.autoSave mode maps to its policy and its triggers', () => {
    const map = (mode: AutoSaveMode) => ({
      policy: autosavePolicyOf({ mode, delayMs: 750 }),
      triggers: FLUSH_TRIGGERS[mode],
    });
    expect(map('off')).toEqual({ policy: null, triggers: [] });
    expect(map('afterDelay')).toEqual({
      policy: { kind: 'afterDelay', delayMs: 750 },
      triggers: [],
    });
    expect(map('onFocusChange')).toEqual({
      policy: { kind: 'onFlush' },
      triggers: ['pageBlur', 'windowBlur', 'unfocusedEdit'],
    });
    expect(map('onWindowChange')).toEqual({
      policy: { kind: 'onFlush' },
      triggers: ['windowBlur'],
    });
  });

  test('is read from the files section; a value VS Code does not define is off', () => {
    expect(readAutoSave(configuration({ autoSave: 'afterDelay', autoSaveDelay: 300 }))).toEqual({
      mode: 'afterDelay',
      delayMs: 300,
    });
    expect(readAutoSave(configuration({ autoSave: 'onFocusChange' }))).toEqual({
      mode: 'onFocusChange',
      delayMs: 1000,
    });
    expect(readAutoSave(configuration({ autoSave: 'sometimes' })).mode).toBe('off');
    expect(readAutoSave(configuration({})).mode).toBe('off');
  });
});

// A window: the fake engine, root sessions with the keeper attached, and the
// VS Code events the keeper listens to.
function window(settings: Record<string, Record<string, unknown>>) {
  const engine = fakeEngine();
  const configListeners = new Set<(e: { affectsConfiguration: (s: string) => boolean }) => void>();
  const windowListeners = new Set<(s: { focused: boolean }) => void>();
  const read: string[] = [];
  const api = {
    workspace: {
      getConfiguration: vi.fn((section: string, scope: { fsPath: string }) => {
        read.push(`${section}:${scope.fsPath}`);
        return configuration(settings[scope.fsPath] ?? {});
      }),
      onDidChangeConfiguration: (listener: never) => {
        configListeners.add(listener);
        return { dispose: () => configListeners.delete(listener) };
      },
      asRelativePath: (path: string) => path.replace('/repo/', ''),
    },
    window: {
      onDidChangeWindowState: (listener: never) => {
        windowListeners.add(listener);
        return { dispose: () => windowListeners.delete(listener) };
      },
      showErrorMessage: vi.fn(async () => undefined),
    },
    Uri: { file: (path: string) => ({ fsPath: path }) },
  };
  const log: string[] = [];
  const keeper = createAutosaveKeeper(api as never, (line) => log.push(line));
  const rootSessions = createRootSessions({
    engine: { caller: async () => engine.caller, whenRunning: async () => engine.caller },
    report: (_what, error) => log.push(String(error)),
  });
  rootSessions.observe(keeper.attach);
  return {
    engine,
    api,
    keeper,
    rootSessions,
    log,
    read,
    saves: () => engine.count('SessionSave'),
    changeSetting: (section: string) => {
      for (const listener of [...configListeners]) {
        listener({ affectsConfiguration: (s) => s === section });
      }
    },
    windowFocus: (focused: boolean) => {
      for (const listener of [...windowListeners]) listener({ focused });
    },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('onFocusChange', () => {
  const settings = { '/repo/infra': { autoSave: 'onFocusChange' } };

  test("an edit stays unsaved while the page has focus, whatever the wait, and is saved at the page's blur", async () => {
    const w = window(settings);
    const hold = await w.rootSessions.acquire('/repo/infra');
    w.keeper.pageFocus(hold.sessionId, true);

    w.engine.edit(hold.sessionId);
    await wait(30);
    expect(w.saves()).toBe(0);

    w.keeper.pageFocus(hold.sessionId, false);
    await settled();
    expect(w.saves()).toBe(1);
    expect(w.read).toEqual(['files:/repo/infra']);
  });

  test('an edit made while the page has no focus is saved at once', async () => {
    const w = window(settings);
    const hold = await w.rootSessions.acquire('/repo/infra');
    w.keeper.pageFocus(hold.sessionId, true);
    w.keeper.pageFocus(hold.sessionId, false);
    await settled();
    expect(w.saves()).toBe(0);

    // A tool or the registry's "+" applies while focus is elsewhere.
    w.engine.edit(hold.sessionId);
    await settled();
    expect(w.saves()).toBe(1);
  });

  test('the window losing focus saves', async () => {
    const w = window(settings);
    const hold = await w.rootSessions.acquire('/repo/infra');
    w.keeper.pageFocus(hold.sessionId, true);
    w.engine.edit(hold.sessionId);
    await settled();

    w.windowFocus(false);
    await settled();
    expect(w.saves()).toBe(1);
  });
});

describe('onWindowChange', () => {
  test("the window losing focus saves; the page's blur does not", async () => {
    const w = window({ '/repo/infra': { autoSave: 'onWindowChange' } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    w.keeper.pageFocus(hold.sessionId, true);
    w.engine.edit(hold.sessionId);
    w.keeper.pageFocus(hold.sessionId, false);
    await settled();
    expect(w.saves()).toBe(0);

    w.windowFocus(false);
    await settled();
    expect(w.saves()).toBe(1);
  });
});

describe('the last release', () => {
  test('with a policy on, an edit released inside the delay is saved before the session closes', async () => {
    const w = window({ '/repo/infra': { autoSave: 'afterDelay', autoSaveDelay: 60_000 } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    const id = hold.sessionId;
    w.engine.edit(id);
    await settled();

    await hold.release();
    const methods = w.engine.sent.map((s) => s.method);
    expect(methods.indexOf('SessionSave')).toBeGreaterThan(-1);
    expect(methods.indexOf('SessionSave')).toBeLessThan(methods.indexOf('SessionClose'));
    expect(w.engine.open()).toEqual([]);
  });

  test('with off, the edit is discarded with the session', async () => {
    const w = window({ '/repo/infra': { autoSave: 'off' } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    w.engine.edit(hold.sessionId);
    await settled();

    await hold.release();
    expect(w.saves()).toBe(0);
    expect(w.engine.count('SessionClose')).toBe(1);
  });
});

describe('a change to the setting', () => {
  test('re-attaches under the new mode', async () => {
    const settings: Record<string, Record<string, unknown>> = {
      '/repo/infra': { autoSave: 'off' },
    };
    const w = window(settings);
    const hold = await w.rootSessions.acquire('/repo/infra');
    w.keeper.pageFocus(hold.sessionId, true);
    w.engine.edit(hold.sessionId);
    w.keeper.pageFocus(hold.sessionId, false);
    await settled();
    expect(w.saves()).toBe(0);

    settings['/repo/infra'] = { autoSave: 'onFocusChange' };
    w.changeSetting('editor.fontSize');
    await settled();
    expect(w.saves()).toBe(0);

    w.changeSetting('files.autoSave');
    await settled();
    // Re-attached while the page has no focus: the unsaved edit is saved.
    expect(w.saves()).toBe(1);
  });
});

describe('a save that fails', () => {
  test('goes to the Output channel and a notification, saying it was not saved and why', async () => {
    const w = window({ '/repo/infra': { autoSave: 'onWindowChange' } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    w.engine.edit(hold.sessionId);
    w.engine.refuse('SessionSave', 'REASON_SOURCE_REFUSED', 'the tf does not parse');
    await settled();

    w.windowFocus(false);
    await settled();
    await settled();
    expect(w.log).toEqual([
      'The canvas of /repo/infra was not saved (source_refused): [failed_precondition] the tf does not parse',
    ]);
    expect(w.api.window.showErrorMessage).toHaveBeenCalledWith(
      'The canvas of infra was not saved (source_refused): [failed_precondition] the tf does not parse',
    );
  });

  test('at the close, the save of a source that turned refused is asked for, its refusal is said the same way, and the session still closes', async () => {
    const w = window({ '/repo/infra': { autoSave: 'onWindowChange' } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    w.engine.edit(hold.sessionId);
    w.engine.refuseSource(hold.sessionId);
    await settled();

    await hold.release();
    expect(w.saves()).toBe(1);
    const said =
      'was not saved (source_refused): [failed_precondition] the source tf is refused; fix it, then edit, save or generate again';
    expect(w.log).toEqual([`The canvas of /repo/infra ${said}`]);
    expect(w.api.window.showErrorMessage).toHaveBeenCalledWith(`The canvas of infra ${said}`);
    expect(w.engine.sent.filter((s) => s.method === 'SessionClose')).toHaveLength(1);
    expect(w.rootSessions.held()).toEqual([]);
  });

  test('at the close, a save whose saved frame never came could not be confirmed, and the session still closes', async () => {
    const w = window({ '/repo/infra': { autoSave: 'onWindowChange' } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    w.engine.edit(hold.sessionId);
    await settled();
    const answerSave = w.engine.defer('SessionSave');

    const released = hold.release();
    await settled();
    expect(w.saves()).toBe(1);
    // The session's stream ends before the engine answers the save, so the
    // frame it names never reaches this window.
    w.engine.failStreams(hold.sessionId);
    answerSave();
    await released;

    const said =
      'could not confirm the save of the canvas of /repo/infra: its session ended before the engine reported the canvas saved.';
    expect(w.log).toEqual([`Lace ${said}`]);
    expect(w.api.window.showErrorMessage).toHaveBeenCalledWith(
      'Lace could not confirm the save of the canvas of infra: its session ended before the engine reported the canvas saved.',
    );
    expect(w.engine.sent.filter((s) => s.method === 'SessionClose')).toHaveLength(1);
    expect(w.rootSessions.held()).toEqual([]);
  });

  test('a save whose saved frame never came could not be confirmed, which is not a refusal', () => {
    expect(saveFailureText('infra', new ApplyUnobservedError({ kind: 'closed' }))).toBe(
      'Lace could not confirm the save of the canvas of infra: its session ended before the engine reported the canvas saved.',
    );
    expect(saveFailureText('infra', new Error('gone'))).toBe(
      'Lace could not save the canvas of infra: gone',
    );
  });
});
