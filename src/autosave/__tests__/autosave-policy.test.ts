import { ApplyUnobservedError } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import { customEditors } from '../../canvas/__tests__/fake-custom-editor';
import { createCanvasPanels } from '../../canvas/canvas-panels';
import { fakeEngine, settled } from '../../engine/__tests__/fake-engine';
import { createRootSessions } from '../../engine/root-sessions';
import { folder, uri } from '../../roots/__tests__/fake-uri';
import { memento } from '../../stacks/__tests__/stack-fixtures';
import { createRootState } from '../../state/root-state';
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

describe('a root with a canvas open', () => {
  // The canvas document's own save, which saves the session as VS Code does.
  const documentSave = (w: ReturnType<typeof window>, root: string) =>
    vi.fn(async () => {
      const [held] = w.rootSessions.held().filter((session) => session.root === root);
      await held.ports.editor.save();
    });

  test('is saved under the folder’s policy through the canvas document, not the session’s own save', async () => {
    const w = window({ '/repo/infra': { autoSave: 'onWindowChange' } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    const save = documentSave(w, '/repo/infra');
    const release = w.keeper.claimSaving('/repo/infra', save);
    w.engine.edit(hold.sessionId);
    await settled();

    w.windowFocus(false);
    await settled();

    expect(save).toHaveBeenCalledOnce();
    expect(w.saves()).toBe(1);
    release();
  });

  test('under onFocusChange an edit made while the canvas page has no focus is saved through the document', async () => {
    const w = window({ '/repo/infra': { autoSave: 'onFocusChange' } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    const save = documentSave(w, '/repo/infra');
    w.keeper.claimSaving('/repo/infra', save);
    // A change of the setting arms the session again, with the canvas open.
    w.changeSetting('files.autoSave');
    w.keeper.pageFocus(hold.sessionId, true);
    w.keeper.pageFocus(hold.sessionId, false);
    await settled();
    expect(save).not.toHaveBeenCalled();

    // A tool's edit while the canvas page is unfocused.
    w.engine.edit(hold.sessionId);
    await settled();

    expect(save).toHaveBeenCalledOnce();
    expect(w.saves()).toBe(1);
  });

  test('under afterDelay the timer saves through the document', async () => {
    const w = window({ '/repo/infra': { autoSave: 'afterDelay', autoSaveDelay: 20 } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    const save = documentSave(w, '/repo/infra');
    w.keeper.claimSaving('/repo/infra', save);

    w.engine.edit(hold.sessionId);
    await wait(80);

    expect(save).toHaveBeenCalledOnce();
  });

  test('under afterDelay the window closing saves the unsaved edit with the session’s own save', async () => {
    const w = window({ '/repo/infra': { autoSave: 'afterDelay', autoSaveDelay: 10_000 } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    const save = vi.fn(async () => {});
    w.keeper.claimSaving('/repo/infra', save);
    w.engine.edit(hold.sessionId);
    await settled();

    await w.rootSessions.dispose();

    expect(w.saves()).toBe(1);
    expect(save).not.toHaveBeenCalled();
  });

  test('under off nothing is attached: the window closing saves nothing', async () => {
    const w = window({ '/repo/infra': { autoSave: 'off' } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    w.keeper.claimSaving('/repo/infra', async () => {});
    w.engine.edit(hold.sessionId);
    await settled();

    await w.rootSessions.dispose();

    expect(w.saves()).toBe(0);
  });

  test('edits the canvas closed over are declined by their digest: the keeper saves the next edit, not those', async () => {
    const w = window({ '/repo/infra': { autoSave: 'afterDelay', autoSaveDelay: 20 } });
    const tool = await w.rootSessions.acquire('/repo/infra');
    const canvas = await w.rootSessions.acquire('/repo/infra');
    const end = w.keeper.claimSaving('/repo/infra', async () => {});
    w.engine.edit(canvas.sessionId);
    await settled();
    // The canvas closes over the first edit (digest working-1).
    end('working-1');
    await wait(80);
    expect(w.saves()).toBe(0);

    w.engine.edit(tool.sessionId);
    await wait(80);

    expect(w.saves()).toBe(1);
  });

  test('is saved by the session’s own save again once the canvas is closed', async () => {
    const w = window({ '/repo/infra': { autoSave: 'onWindowChange' } });
    const hold = await w.rootSessions.acquire('/repo/infra');
    const save = vi.fn(async () => {});
    w.keeper.claimSaving('/repo/infra', save)();
    w.engine.edit(hold.sessionId);
    await settled();

    w.windowFocus(false);
    await settled();

    expect(w.saves()).toBe(1);
    expect(save).not.toHaveBeenCalled();
  });
});

// The canvas panels over the real keeper and real root sessions, as VS Code
// drives them: an editor resolved for the document, then reverted and closed.
function canvasOver(w: ReturnType<typeof window>) {
  const editors = customEditors();
  const api = {
    window: { activeTextEditor: undefined, ...editors.window },
    commands: editors.commands,
    workspace: {
      workspaceFolders: [folder('/repo')],
      onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
      // VS Code saves the document it is asked to save.
      save: vi.fn(async (at: unknown) => {
        await editors.save(editors.documents[0]);
        return at;
      }),
    },
    EventEmitter: editors.EventEmitter,
    ViewColumn: { Active: -1, Beside: -2 },
    TabInputCustom: editors.TabInputCustom,
  };
  const panels = createCanvasPanels({
    api: api as never,
    extensionUri: uri('/ext'),
    engine: { serve: async () => () => {} },
    rootSessions: w.rootSessions,
    rootState: createRootState(memento()),
    confirm: async () => true,
    pageFocus: w.keeper.pageFocus,
    claimSaving: w.keeper.claimSaving,
    offers: {} as never,
    validate: async () => {},
    importResources: async () => {},
    generated: async () => {},
    report: (_what, error) => w.log.push(String(error)),
  });
  return {
    // The page boots and reports the working digest of each frame it draws.
    async open() {
      const held = await panels.ensure({ folder: folder('/repo'), relative: 'infra' });
      held.hold.ports.source.subscribe(
        (frame) => {
          editors.panels[0].receive({
            ch: 'host',
            frame: { kind: 'notice', notice: { op: 'digest', value: frame.workingDigest } },
          });
        },
        () => {},
      );
      return held;
    },
    revert: () => editors.revert(editors.documents[0]),
    close: () => editors.panels[0].panel.dispose(),
    // Don't Save: VS Code reverts the document, then closes the tab.
    async dontSave() {
      await editors.revert(editors.documents[0]);
      editors.panels[0].panel.dispose();
      await settled();
      await settled();
    },
  };
}

describe("closing a canvas with Don't Save", () => {
  test('under files.autoSave afterDelay the engine receives no save: the last release finds no autosave attached', async () => {
    const w = window({ '/repo/infra': { autoSave: 'afterDelay', autoSaveDelay: 10_000 } });
    const canvas = canvasOver(w);

    const held = await canvas.open();
    w.engine.edit(held.hold.sessionId);
    await settled();
    await canvas.dontSave();

    expect(w.saves()).toBe(0);
    expect(w.log).toEqual([]);
  });

  describe('after the edits were saved another way', () => {
    test('a tool’s session is not declined: its later edit is still autosaved', async () => {
      const w = window({ '/repo/infra': { autoSave: 'afterDelay', autoSaveDelay: 20 } });
      const canvas = canvasOver(w);
      const tool = await w.rootSessions.acquire('/repo/infra');
      const held = await canvas.open();
      w.engine.edit(held.hold.sessionId);
      await settled();
      // Revert File, then the canvas's Save button.
      await canvas.revert();
      await held.hold.ports.editor.save();
      await settled();
      expect(w.saves()).toBe(1);

      canvas.close();
      await settled();
      w.engine.edit(tool.sessionId);
      await wait(80);

      expect(w.saves()).toBe(2);
    });
  });

  describe('while a chat tool holds the same root', () => {
    test('under afterDelay the declined edits are not saved after the canvas closes', async () => {
      const w = window({ '/repo/infra': { autoSave: 'afterDelay', autoSaveDelay: 20 } });
      const canvas = canvasOver(w);
      const tool = await w.rootSessions.acquire('/repo/infra');
      const held = await canvas.open();
      w.engine.edit(held.hold.sessionId);
      await settled();
      await canvas.dontSave();

      await wait(80);

      expect(w.saves()).toBe(0);
      await tool.release();
      await settled();
      expect(w.saves()).toBe(0);
    });

    test('a tab closed with the edits unsaved and no revert declines them too', async () => {
      const w = window({ '/repo/infra': { autoSave: 'afterDelay', autoSaveDelay: 20 } });
      const canvas = canvasOver(w);
      const tool = await w.rootSessions.acquire('/repo/infra');
      const held = await canvas.open();
      w.engine.edit(held.hold.sessionId);
      await settled();

      canvas.close();
      await wait(80);
      expect(w.saves()).toBe(0);

      await tool.release();
      await settled();
      expect(w.saves()).toBe(0);
    });

    test('under onWindowChange neither a blur nor the tool’s last release saves them', async () => {
      const w = window({ '/repo/infra': { autoSave: 'onWindowChange' } });
      const canvas = canvasOver(w);
      const tool = await w.rootSessions.acquire('/repo/infra');
      const held = await canvas.open();
      w.engine.edit(held.hold.sessionId);
      await settled();
      await canvas.dontSave();

      w.windowFocus(false);
      await settled();
      await tool.release();
      await settled();

      expect(w.saves()).toBe(0);
    });
  });
});
