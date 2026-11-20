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
// A root with a canvas open (`claimSaving`) is saved under the same policy,
// through the canvas's document (`save`), so VS Code clears the tab and a
// session saved by the timer is not saved again by VS Code's own autosave:
// saves of one document go one after another and a save of a saved session
// does nothing. A tab closed with unsaved edits declines them: the canvas ends
// its claim, before it releases its hold, with the working digest it
// declined, and the keeper attaches no autosave to that session until a frame
// carries another digest (a later edit, a save or a discard), so neither the
// last release's flush nor, when another holder (a chat tool) keeps the
// session, a timer saves them; only that holder's own explicit save does.
//
// Under every mode but `off`, the last release of a root's session saves
// before the session is closed (root sessions flush it), and so does the
// window closing, with the session's own save even when a canvas is open. The
// keeper observes the root sessions: each session they hold has one autosave,
// re-armed under the new mode when the setting changes.
import {
  ApplyUnobservedError,
  type Autosave,
  type AutosavePolicy,
  autosave,
  ConnectError,
  type SourcePort,
} from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { failureText } from '../engine/command-outcome';
import { refusedText } from '../engine/refusal';
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
    return refusedText(`The canvas of ${named} was not saved`, error);
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
  // A canvas is open on the session of `root` (as the session spells it): its
  // autosave saves through `save`, the canvas document's own, until the
  // returned function is called. Called with `declined`, the working digest of
  // the edits the canvas closed over, those edits were declined (Don't Save)
  // and stay unsaved by the keeper, in a session another holder keeps, until a
  // frame carries another digest.
  claimSaving: (root: string, save: () => Promise<void>) => (declined?: string) => void;
  dispose: () => void;
};

type Kept = {
  session: RootSession;
  saver: Autosave | null;
  triggers: readonly FlushTrigger[];
  unwatch: () => void;
  // The working digest of declined edits: no autosave attached until a frame
  // carries another.
  declined: string | null;
};

export function createAutosaveKeeper(api: PolicyApi, log: (line: string) => void): AutosaveKeeper {
  const kept = new Set<Kept>();
  const focused = new Set<string>();
  // What saves a root a canvas has open: the canvas document's own save.
  const claimed = new Map<string, () => Promise<void>>();
  const withheld = (k: Kept) => k.declined !== null;
  const saveOf = (k: Kept): Promise<void> =>
    claimed.get(k.session.root)?.() ?? k.session.ports.editor.save();

  function report(session: RootSession, error: unknown): void {
    log(saveFailureText(session.root, error));
    void api.window.showErrorMessage(
      saveFailureText(api.workspace.asRelativePath(session.root), error),
    );
  }

  const flush = (k: Kept, saver: Autosave | null = k.saver): Promise<void> =>
    (saver?.flush() ?? Promise.resolve()).catch((error) => report(k.session, error));

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
    const { source } = k.session.ports;
    const setting = readAutoSave(
      api.workspace.getConfiguration('files', api.Uri.file(k.session.root)),
    );
    // Declined edits are saved by no autosave, as under `off`.
    const effective: AutoSaveSetting = withheld(k) ? { ...setting, mode: 'off' } : setting;
    const policy = autosavePolicyOf(effective);
    k.triggers = FLUSH_TRIGGERS[effective.mode];
    k.saver = policy
      ? autosave(
          source,
          () => saveOf(k),
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
      const k: Kept = {
        session,
        saver: null,
        triggers: [],
        unwatch: () => {},
        declined: null,
      };
      arm(k);
      kept.add(k);
      const unwatchSaved = session.ports.source.subscribe(
        (frame) => {
          if (!withheld(k) || frame.workingDigest === k.declined) return;
          k.declined = null;
          arm(k);
        },
        () => {},
      );
      return {
        // A flush at a close or the window's end saves with the session's own
        // save: the canvas's document is not there to be saved then. What it
        // saves is what the armed autosave would: nothing under `off` or for
        // declined edits.
        async flush() {
          if (k.saver === null) return;
          const once = autosave(
            session.ports.source,
            () => session.ports.editor.save(),
            { kind: 'onFlush' },
            (error) => report(session, error),
          );
          try {
            await flush(k, once);
          } finally {
            once.dispose();
          }
        },
        dispose() {
          unwatchSaved();
          kept.delete(k);
          k.unwatch();
          k.saver?.dispose();
        },
      };
    },
    claimSaving(root, save) {
      claimed.set(root, save);
      let released = false;
      return (declined) => {
        if (released) return;
        released = true;
        if (claimed.get(root) === save) claimed.delete(root);
        if (declined === undefined) return;
        for (const k of kept) {
          if (k.session.root !== root) continue;
          k.declined = declined;
          arm(k);
        }
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
