// When a canvas's unsaved edits are saved in VS Code: the host's own
// `files.autoSave`, read for the workspace folder the root is in. What Save
// is stays the session's (`editor.save`, the Save button's); this module
// says only when, through the package's `autosave` primitive.
//
//   off             no autosave is attached: closing the root's last holder
//                   discards unsaved edits
//   afterDelay      saved `files.autoSaveDelay` after the latest edit
//   onFocusChange   saved when the canvas page loses focus, when the window
//                   does, and as soon as an edit lands while the root's page
//                   does not have focus — the surface that made it (a tool,
//                   the registry's "+") has already been left
//   onWindowChange  saved when the window loses focus
//
// Under every mode but `off` the last release of a root's session saves
// before the session is closed (root sessions flush it), and so does the
// window closing. The keeper observes the root sessions: each session they
// hold has one autosave, re-armed under the new mode when the setting
// changes.
import {
  ApplyUnobservedError,
  type Autosave,
  type AutosavePolicy,
  autosave,
  ConnectError,
  reasonWire,
  type SourcePort,
} from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { failureText } from '../engine/command-outcome';
import type { RootSession, SessionObserver } from '../engine/root-sessions';

export const AUTOSAVE_MODES = ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'] as const;
export type AutoSaveMode = (typeof AUTOSAVE_MODES)[number];
export type AutoSaveSetting = { mode: AutoSaveMode; delayMs: number };

// What makes a session saved now, beside a timer.
export type FlushTrigger = 'pageBlur' | 'windowBlur' | 'unfocusedEdit';

const POLICIES: Readonly<Record<AutoSaveMode, (delayMs: number) => AutosavePolicy | null>> = {
  off: () => null,
  afterDelay: (delayMs) => ({ kind: 'afterDelay', delayMs }),
  onFocusChange: () => ({ kind: 'onFlush' }),
  onWindowChange: () => ({ kind: 'onFlush' }),
};

export const FLUSH_TRIGGERS: Readonly<Record<AutoSaveMode, readonly FlushTrigger[]>> = {
  off: [],
  afterDelay: [],
  onFocusChange: ['pageBlur', 'windowBlur', 'unfocusedEdit'],
  onWindowChange: ['windowBlur'],
};

// The autosave primitive's policy for a setting; null for `off`, under which
// nothing is attached.
export function autosavePolicyOf(setting: AutoSaveSetting): AutosavePolicy | null {
  return POLICIES[setting.mode](setting.delayMs);
}

const isMode = (value: unknown): value is AutoSaveMode =>
  (AUTOSAVE_MODES as readonly unknown[]).includes(value);

// `files.autoSave` and `files.autoSaveDelay` from the `files` section read for
// one root's folder.
export function readAutoSave(configuration: vscode.WorkspaceConfiguration): AutoSaveSetting {
  const mode = configuration.get<string>('autoSave');
  return {
    mode: isMode(mode) ? mode : 'off',
    delayMs: configuration.get<number>('autoSaveDelay', 1000),
  };
}

// What a save that failed says of the canvas `named`. A save the engine
// took whose saved frame never came, since the session's stream ended
// first, could not be confirmed; a save the engine refused was not saved,
// for the reason it gave.
export function saveFailureText(named: string, error: unknown): string {
  if (error instanceof ApplyUnobservedError) {
    return `Lace could not confirm the save of the canvas of ${named}: its session ended before the engine reported the canvas saved.`;
  }
  if (error instanceof ConnectError) {
    return `The canvas of ${named} was not saved (${error.apiCode ?? reasonWire(error.reason)}): ${error.message}`;
  }
  return `Lace could not save the canvas of ${named}: ${failureText(error)}`;
}

type PolicyApi = {
  workspace: Pick<
    typeof vscode.workspace,
    'getConfiguration' | 'onDidChangeConfiguration' | 'asRelativePath'
  >;
  window: Pick<typeof vscode.window, 'onDidChangeWindowState' | 'showErrorMessage'>;
  Uri: Pick<typeof vscode.Uri, 'file'>;
};

export type AutosaveKeeper = {
  // The autosave of one session root sessions hold: it saves under the mode
  // the root's folder sets now, and under each mode the setting changes to.
  // Its `flush` reports a save that failed and resolves.
  attach: SessionObserver;
  // The canvas page open on `sessionId` gained or lost focus.
  pageFocus: (sessionId: string, focused: boolean) => void;
  dispose: () => void;
};

type Kept = {
  session: RootSession;
  saver: Autosave | null;
  triggers: readonly FlushTrigger[];
  unwatch: () => void;
};

export function createAutosaveKeeper(api: PolicyApi, log: (line: string) => void): AutosaveKeeper {
  const kept = new Set<Kept>();
  const focused = new Set<string>();

  function report(session: RootSession, error: unknown): void {
    log(saveFailureText(session.root, error));
    void api.window.showErrorMessage(
      saveFailureText(api.workspace.asRelativePath(session.root), error),
    );
  }

  const flush = (k: Kept): Promise<void> =>
    (k.saver?.flush() ?? Promise.resolve()).catch((error) => report(k.session, error));

  // A frame that reports unsaved edits while the root's page has no focus.
  // Subscribed after the primitive, so the primitive has the frame first.
  const watchUnfocused = (k: Kept, source: SourcePort): (() => void) =>
    source.subscribe(
      (frame) => {
        if (frame.unsaved && !focused.has(k.session.sessionId)) void flush(k);
      },
      () => {},
    );

  function arm(k: Kept): void {
    k.saver?.dispose();
    k.unwatch();
    const { source, editor } = k.session.ports;
    const setting = readAutoSave(
      api.workspace.getConfiguration('files', api.Uri.file(k.session.root)),
    );
    const policy = autosavePolicyOf(setting);
    k.triggers = FLUSH_TRIGGERS[setting.mode];
    k.saver = policy
      ? autosave(
          source,
          () => editor.save(),
          policy,
          (error) => report(k.session, error),
        )
      : null;
    k.unwatch = k.triggers.includes('unfocusedEdit') ? watchUnfocused(k, source) : () => {};
  }

  const flushOn = (trigger: FlushTrigger): void => {
    for (const k of kept) if (k.triggers.includes(trigger)) void flush(k);
  };

  const subscriptions = [
    api.workspace.onDidChangeConfiguration((change) => {
      if (
        change.affectsConfiguration('files.autoSave') ||
        change.affectsConfiguration('files.autoSaveDelay')
      ) {
        for (const k of kept) arm(k);
      }
    }),
    api.window.onDidChangeWindowState((state) => {
      if (!state.focused) flushOn('windowBlur');
    }),
  ];

  return {
    attach(session) {
      const k: Kept = { session, saver: null, triggers: [], unwatch: () => {} };
      arm(k);
      kept.add(k);
      return {
        flush: () => flush(k),
        dispose() {
          kept.delete(k);
          k.unwatch();
          k.saver?.dispose();
        },
      };
    },
    pageFocus(sessionId, isFocused) {
      if (isFocused) {
        focused.add(sessionId);
        return;
      }
      focused.delete(sessionId);
      flushOn('pageBlur');
    },
    dispose() {
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
}
