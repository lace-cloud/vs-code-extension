// The canvas panels: one custom editor per authoring root, and the one
// long-lived holder of that root's session. A canvas is a document of the
// `lace-canvas` scheme, named by its root (`rootUri` with that scheme), so
// VS Code owns what a tab with unsaved edits owns: its dirty marker, and on
// close the Save / Don't Save / Cancel prompt. A panel comes to exist when
// VS Code resolves the document's editor: `ensure` opens the document and
// waits for that resolve, and VS Code resolves it too on its own (a canvas tab
// restored on reload, Reopen With, the document opened directly), where no
// one waits and the panel is taken as any other. The resolve takes the hold
// before the page boots, and `ensure` resolves once the hold exists. A panel
// whose first boot cannot be served closes, giving its hold back. Every
// editing entry point that is not the canvas itself calls `ensure` first, so
// no edit is ever made by the last holder.
//
// The document is dirty exactly when the engine's frames say the session is
// unsaved: the host follows the session's frames itself, and when the session
// is saved by any other way (the canvas's Save button, a tool) the panel
// asks VS Code to save the document, by its URI, so the tab clears, unless
// the session was edited again since the frame that said it was saved. Save
// on the document is the session's own save, the one the Save button runs,
// and returns at once on a clean session. VS Code clears a document's dirty
// state after the save or revert it asked for resolves, and a session that
// turned unsaved again meanwhile is told again when the tab shows clean
// (`onDidChangeTabs`). Revert (Don't Save, Revert File) is the engine's
// Discard of the working digest the page last drew, so the edits another
// holder made since are never discarded unseen. There is no backup: closing a
// tab asks Save / Don't Save / Cancel, while quitting or reloading the window
// under hot exit reports that the canvas could not be saved to the backup
// location, and going on anyway discards its unsaved edits. A document has no
// Save As. A canvas open at window start is restored on reload, as any
// editor is; one whose folder left the workspace is closed when VS Code
// resolves it. While a canvas is open the autosave keeper saves its root
// through the document (`claimSaving`), and a tab closed with unsaved edits
// declines them: the keeper does not save those edits, in a session another
// holder keeps, until the session moves on.
//
// The page reaches the engine over the bridge the panel serves and the host
// over the host protocol, both on the panel's one postMessage pair. When the
// hold's session is opened again after an end, the panel disposes the bridge
// it served and serves a new one, and assigns new HTML: the page boots again
// through its one path.
//
// A panel opened without focus (a chat tool, the registry's add) opens
// beside the text editor the developer is in, so their place stays in view;
// with no text editor in the active group it opens there, where a split
// would leave an empty group. A panel opened with focus (Lace: Open Canvas)
// takes the active group as any editor does. A panel already open is
// revealed in its own column.
//
// The panel is titled by the root's name among the workspace's folders open
// now (`rootLabel`); a change of the workspace's folders titles it again. A
// tab whose folder left the workspace stays open on its session, titled by
// its directory's full path. What the panel reports of a failure names the root as it is named
// when the failure is reported.
//
// The page boots with the stack picked for its root, and hears each later
// pick and each tick (a run the host started settled) as an event; it
// reports its focus, which the autosave policy reads. A notice the page
// sends is shown with the ways out the failure it carries names; its
// Validate validates the panel's root. The canvas's own Generate ends with
// the notice Lace: Generate shows, Show Changes among it. Open source on a
// Diagnostics row asks the host to open a file of the root at a line and
// column, in the editor beside the canvas. Import existing resources on the
// source-refused banner asks the host to run Import Existing Resources on
// the panel's root.

import {
  ApplyUnobservedError,
  type CanvasSource,
  ConnectError,
  type GeneratedTree,
} from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { type AutosaveKeeper, saveFailureText } from '../autosave/autosave-policy';
import { positionOf } from '../diagnostics/problems';
import { failureText } from '../engine/command-outcome';
import type { Engine } from '../engine/engine';
import { applyErrorsText, refusedText } from '../engine/refusal';
import type { RootHold, RootSessions } from '../engine/root-sessions';
import {
  type Boot,
  type HostNotice,
  postEvent,
  type RawPort,
  type SourceLocation,
  serveHost,
  splitChannel,
} from '../protocol/host-protocol';
import {
  type AuthoringRoot,
  comparablePath,
  fileUri,
  rootLabel,
  rootOfPath,
  rootPath,
  rootUri,
  sameRoot,
} from '../roots/authoring-roots';
import type { RootState } from '../state/root-state';
import { type OfferActions, offersFor, notice as showNotice } from '../vscode/offers';
import { canvasHtml } from '../vscode/webview-html';

export const CANVAS_VIEW_TYPE = 'lace.canvas';
export const CANVAS_SCHEME = 'lace-canvas';

// The document of a root's canvas; `root` is undefined when the directory it
// names is under no folder open in this window.
export type LaceCanvasDocument = vscode.CustomDocument & {
  readonly root: AuthoringRoot | undefined;
};

// The drive letter is folded as `canvasKey` reads it, so the resource VS Code
// keys the document by is the one the key names.
export const canvasUri = (root: AuthoringRoot): vscode.Uri => {
  const at = rootUri(root);
  return at.with({ scheme: CANVAS_SCHEME, path: comparablePath(at) });
};

// What a Discard that failed says of the canvas `named`.
function discardFailureText(named: string, error: unknown): string {
  if (error instanceof ConnectError) {
    return refusedText(`The edits of the canvas of ${named} were not discarded`, error);
  }
  return `Lace could not discard the edits of the canvas of ${named}: ${failureText(error)}`;
}

// What names a canvas's document as VS Code hands its URI back: the directory
// it names, compared as the roots' own comparison does (`comparablePath`).
const canvasKey = (uri: vscode.Uri): string => comparablePath(uri.with({ scheme: 'file' }));

type PanelsApi = {
  window: Pick<
    typeof vscode.window,
    | 'activeTextEditor'
    | 'registerCustomEditorProvider'
    | 'showInformationMessage'
    | 'showWarningMessage'
    | 'showErrorMessage'
    | 'showTextDocument'
    | 'tabGroups'
  >;
  workspace: Pick<
    typeof vscode.workspace,
    'openTextDocument' | 'workspaceFolders' | 'onDidChangeWorkspaceFolders' | 'save'
  >;
  commands: Pick<typeof vscode.commands, 'executeCommand'>;
  EventEmitter: typeof vscode.EventEmitter;
  ViewColumn: Pick<typeof vscode.ViewColumn, 'Active' | 'Beside'>;
  Range: typeof vscode.Range;
  TabInputCustom: typeof vscode.TabInputCustom;
};

export type CanvasPanelsOptions = {
  api: PanelsApi;
  extensionUri: vscode.Uri;
  engine: Pick<Engine, 'serve'>;
  rootSessions: Pick<RootSessions, 'acquire'>;
  rootState: Pick<RootState, 'stack' | 'onDidPickStack' | 'arrangement' | 'arrange'>;
  confirm: (spec: { text: string; typed?: string }) => Promise<boolean>;
  // The page open on the session `sessionId` gained or lost focus.
  pageFocus: (sessionId: string, focused: boolean) => void;
  // A canvas is open on the session of `root`: the keeper's autosave saves
  // it through `save`, the document's own, so the tab clears. Returns what
  // ends it. Ending it with `declined`, the working digest the session holds
  // when the tab closed over unsaved edits (the declined edits, and any
  // another holder made since the page drew), says the keeper does not save
  // that state.
  claimSaving: AutosaveKeeper['claimSaving'];
  // What a notice from a page offers, and Validate on a root.
  offers: OfferActions;
  validate: (root: AuthoringRoot) => Promise<void>;
  // Import Existing Resources on a root.
  importResources: (root: AuthoringRoot) => Promise<void>;
  // What the page's own Generate that succeeded shows, from what the
  // package reads of the tree it wrote.
  generated: (root: AuthoringRoot, tree: GeneratedTree) => Promise<void>;
  report: (what: string, error: unknown) => void;
};

export type CanvasPanels = {
  // Creates the root's panel, or reveals it. Resolves once the panel holds
  // the root's session.
  ensure: (root: AuthoringRoot, options?: { preserveFocus?: boolean }) => Promise<CanvasPanel>;
  // The root of the panel that is active, when one is.
  activeRoot: () => AuthoringRoot | undefined;
  // The roots of every panel open, active or not.
  roots: () => readonly AuthoringRoot[];
  // The working digest the page of the canvas on the directory `path` (as
  // the engine is told it) last reported drawing, when it has reported one.
  drawnDigest: (path: string) => string | undefined;
  // `listener` is called with a panel's root each time that panel becomes
  // the active one.
  onDidChangeActive: (listener: (root: AuthoringRoot) => void) => () => void;
  // Tells the root's page, when one is open, that its reads are stale.
  tick: (root: AuthoringRoot) => void;
  dispose: () => void;
};

export type CanvasPanel = {
  readonly root: AuthoringRoot;
  readonly hold: RootHold;
  readonly panel: vscode.WebviewPanel;
};

export function createCanvasPanels(options: CanvasPanelsOptions): CanvasPanels {
  const {
    api,
    engine,
    rootSessions,
    rootState,
    confirm,
    pageFocus,
    claimSaving,
    offers,
    validate,
    importResources,
    generated,
    report,
  } = options;
  const panels: Entry[] = [];
  const activated = new Set<(root: AuthoringRoot) => void>();
  const changed = new api.EventEmitter<
    vscode.CustomDocumentContentChangeEvent<LaceCanvasDocument>
  >();

  type Entry = CanvasPanel & {
    tick: () => void;
    document: LaceCanvasDocument;
    save: () => Promise<void>;
    revert: () => Promise<void>;
    // The working digest of the edits the developer declines by closing
    // the tab now, when the session holds some.
    declined: () => string | undefined;
    // The working digest the page last reported drawing.
    drawn: () => string | undefined;
  };

  // Something an observer does, with its failure reported and not thrown
  // into the stream that called it; `what` says what it was, read when the
  // failure is reported.
  const guarded =
    <A extends unknown[]>(what: () => string, run: (...args: A) => void | Promise<void>) =>
    (...args: A): void => {
      try {
        const result = run(...args);
        if (result instanceof Promise) result.catch((error) => report(what(), error));
      } catch (error) {
        report(what(), error);
      }
    };

  // The root's name among the workspace's folders open now.
  const labelOf = (root: AuthoringRoot) => rootLabel(root, api.workspace.workspaceFolders ?? []);

  // What an attach or a first serve rejects with when its panel closed first.
  const closedEarly = (root: AuthoringRoot) =>
    new Error(`The canvas of ${labelOf(root)} was closed before it opened.`);

  // The entry of a document, once its editor resolved.
  const entryOf = (document: vscode.CustomDocument): Entry | undefined =>
    panels.find((entry) => canvasKey(entry.document.uri) === canvasKey(document.uri));

  // Takes the root's hold for a panel VS Code made, and wires the panel to
  // it. The panel's close is the one way what the panel set up goes: every
  // subscription, the bridge, the hold and the saving claim. A panel closed
  // while the engine is still answering the hold gives it back when it
  // arrives, and `attach` rejects. A panel whose first serve failed is
  // disposed, and `attach` rejects. A panel on a session another panel
  // already shows gives its hold back and is disposed: the other is the
  // root's one panel.
  async function attach(
    document: LaceCanvasDocument,
    root: AuthoringRoot,
    panel: vscode.WebviewPanel,
  ): Promise<Entry> {
    const label = () => labelOf(root);
    panel.webview.options = { enableScripts: true };
    let entry: Entry | undefined;
    let closed = false;
    // What closes the panel's hold, once it has one.
    let close: (() => void) | undefined;
    panel.onDidDispose(() => {
      closed = true;
      const at = panels.findIndex((candidate) => candidate === entry);
      if (at >= 0) panels.splice(at, 1);
      close?.();
    });
    let hold: RootHold;
    try {
      hold = await rootSessions.acquire(rootPath(root));
    } catch (error) {
      panel.dispose();
      throw error;
    }
    if (closed) {
      await hold.release();
      throw closedEarly(root);
    }
    const twin = panels.find((candidate) => candidate.hold.sessionId === hold.sessionId);
    if (twin) {
      await hold.release();
      panel.dispose();
      return twin;
    }
    const unclaim = claimSaving(hold.root, async () => {
      await api.workspace.save(canvasUri(root));
    });
    const disposables: vscode.Disposable[] = [];
    close = guarded(
      () => `closing the canvas of ${label()}`,
      async () => {
        // The claim ends first, naming the edits the tab closes over, so the
        // flush of the last release does not save what was declined.
        unclaim(entry?.declined());
        pageFocus(hold.sessionId, false);
        for (const disposable of disposables) disposable.dispose();
        await hold.release();
      },
    );
    try {
      entry = await opened(document, root, label, hold, panel, disposables, () => closed);
    } catch (error) {
      if (!closed) panel.dispose();
      throw error;
    }
    panels.push(entry);
    return entry;
  }

  // Wires a new panel to its page and serves the page its first boot; what
  // it sets up, the bridge it serves among them, goes into `disposables`.
  // `label` names the root by the workspace's folders open when it is
  // called: the title, the page's document title and a failure's report read
  // it as they are made.
  async function opened(
    document: LaceCanvasDocument,
    root: AuthoringRoot,
    label: () => string,
    hold: RootHold,
    panel: vscode.WebviewPanel,
    disposables: vscode.Disposable[],
    isClosed: () => boolean,
  ): Promise<Entry> {
    // The page's webview, taken once: a closed panel no longer hands it
    // out, and a message posted to a closed webview goes nowhere. The engine
    // can still answer the page after its tab closed: the calls cut off when
    // its bridge stops end with a status of their own.
    const { webview } = panel;
    const raw: RawPort = {
      post: (message) => void webview.postMessage(message),
      onMessage: (listener) => {
        const subscription = webview.onDidReceiveMessage(listener);
        return () => subscription.dispose();
      },
    };
    const { engine: bridge, host } = splitChannel(raw);

    const retitle = () => {
      panel.title = label();
    };
    retitle();

    // What the engine's frames say of the session: whether it has unsaved
    // edits, and the digest of its working IR. The document is told so each
    // time the session turns unsaved: VS Code can clear its own dirty state (a
    // save or a revert resolving), so what the host knew of it is never a
    // reason not to tell it.
    let unsaved = false;
    let workingDigest = '';
    // The working digest the page last drew, which is all a Discard may name.
    let drawn: string | undefined;
    // The saves and reverts in progress, one after another, and how many are
    // running.
    let queue: Promise<unknown> = Promise.resolve();
    let saving = 0;
    let reverting = 0;
    // The clears under way, in the order asked: each is the saved frame's
    // digest while the host asks VS Code to clear the tab, until the save that
    // ask makes arrives. The saves arrive in that order, so each takes the
    // first.
    const clears: { digest: string }[] = [];
    // The digest of the edits the developer saw: what the page last drew, and
    // before the page has drawn anything, the latest frame the host holds,
    // whose unsaved mark is all the tab showed.
    const shown = () => drawn ?? workingDigest;
    const markDirty = () => changed.fire({ document });
    const inOrder = <T>(run: () => Promise<T>): Promise<T> => {
      const done = queue.then(run);
      queue = done.catch(() => {});
      return done;
    };
    const clearTab = guarded(
      () => `clearing the tab of the canvas of ${label()}`,
      async (digest: string) => {
        const mine = { digest };
        clears.push(mine);
        try {
          await api.workspace.save(document.uri);
        } finally {
          // Only what this clear asked: its save may not have come, while
          // another clear's has been asked since.
          const at = clears.indexOf(mine);
          if (at >= 0) clears.splice(at, 1);
        }
      },
    );
    const framed = (frame: CanvasSource) => {
      const was = unsaved;
      unsaved = frame.unsaved;
      workingDigest = frame.workingDigest;
      if (unsaved) {
        if (!was) markDirty();
        return;
      }
      // A session saved by another way than the document's save: the tab is
      // cleared by saving the document, which finds the session saved.
      if (was && saving === 0 && reverting === 0) clearTab(frame.workingDigest);
    };
    // The one derivation of the document's dirty state: the frames of the
    // session the hold is on, followed again when the hold's session is
    // opened anew.
    const watch = () => hold.ports.source.subscribe(framed, () => {});
    let unwatch = watch();
    disposables.push({ dispose: () => unwatch() });
    disposables.push({
      dispose: hold.renewed(() => {
        unwatch();
        drawn = undefined;
        unwatch = watch();
      }),
    });
    // VS Code clears a document once the save or revert it asked for
    // resolves, whatever came meanwhile: a tab that shows clean while the
    // session is unsaved is told again.
    disposables.push(
      api.window.tabGroups.onDidChangeTabs(
        guarded(
          () => `marking the canvas of ${label()} unsaved`,
          () => {
            const clean = api.window.tabGroups.all
              .flatMap((group) => group.tabs)
              .some(
                ({ input, isDirty }) =>
                  input instanceof api.TabInputCustom &&
                  input.viewType === CANVAS_VIEW_TYPE &&
                  canvasKey(input.uri) === canvasKey(document.uri) &&
                  !isDirty,
              );
            if (unsaved && clean && !isClosed()) markDirty();
          },
        ),
      ),
    );

    const save = (): Promise<void> =>
      inOrder(async () => {
        // A save that arrives while clears are under way is the first
        // one's own, and it writes only the edits that clear's saved frame
        // had: an edit that came since stays unsaved, dirty in VS Code. One
        // that arrives with none under way is the developer's or VS Code's
        // autosave, and writes what it finds.
        const clear = clears.shift();
        if (!unsaved) return;
        if (clear !== undefined && workingDigest !== clear.digest) return;
        saving += 1;
        try {
          await hold.ports.editor.save();
        } catch (error) {
          throw new Error(saveFailureText(label(), error));
        } finally {
          saving -= 1;
        }
      });
    const revert = (): Promise<void> =>
      inOrder(async () => {
        if (!unsaved) return;
        reverting += 1;
        try {
          const result = await hold.ports.editor.apply([
            { discard: { expected_working_digest: shown() } },
          ]);
          if (!result.success) throw new Error(applyErrorsText(result));
        } catch (error) {
          // A tab closed by Don't Save ends the session's source under the
          // Discard: the engine took the request, and the last holder's close
          // drops what it left, so a Discard whose outcome the close cut off
          // is not a failure.
          if (error instanceof ApplyUnobservedError && isClosed()) return;
          // A tab closed by Don't Save only logs a failed revert, so the
          // developer is told here as well.
          const said = discardFailureText(label(), error);
          void api.window.showErrorMessage(said);
          throw new Error(said);
        } finally {
          reverting -= 1;
        }
      });

    const boot = async (): Promise<Boot> => ({
      root: rootPath(root),
      arrangement: rootState.arrangement(root),
      stack: rootState.stack(root),
    });
    const notice = guarded(
      () => 'a notice from the canvas page',
      (n: HostNotice) => {
        if (n.op === 'focus') pageFocus(hold.sessionId, n.value);
        else if (n.op === 'digest') drawn = n.value;
        else if (n.op === 'arrangement') return rootState.arrange(root, n.value);
        else if (n.op === 'generated') return generated(root, n.tree);
        else {
          const actions = { ...offers, validate: () => validate(root) };
          return showNotice(api, actions, n.level, n.text, offersFor(n.failure)).then(() => {});
        }
      },
    );
    const openSource = async ({ file, line, column }: SourceLocation): Promise<null> => {
      const [at, character] = positionOf({ line, column });
      try {
        const document = await api.workspace.openTextDocument(fileUri(root, file));
        await api.window.showTextDocument(document, {
          viewColumn: api.ViewColumn.Beside,
          selection: new api.Range(at, character, at, character),
        });
      } catch (error) {
        const reason = failureText(error);
        throw new Error(`Lace could not open ${file} in ${label()}: ${reason}`);
      }
      return null;
    };
    const importInto = async (): Promise<null> => {
      await importResources(root);
      return null;
    };
    disposables.push({
      dispose: serveHost(host, {
        boot,
        confirm,
        openSource,
        importResources: importInto,
        notice,
      }),
    });
    disposables.push({
      dispose: rootState.onDidPickStack(
        root,
        guarded(
          () => `telling the canvas of ${label()} its stack`,
          (stack) => {
            postEvent(host, { op: 'stack', value: stack });
          },
        ),
      ),
    });
    disposables.push(
      panel.onDidChangeViewState(
        guarded(
          () => `the canvas of ${label()} becoming active`,
          () => {
            if (!panel.active) return;
            for (const listener of [...activated]) listener(root);
          },
        ),
      ),
    );
    disposables.push(
      api.workspace.onDidChangeWorkspaceFolders(
        guarded(() => `titling the canvas of ${label()}`, retitle),
      ),
    );

    // The bridge the page's engine calls go through; a new one per boot.
    let unserve: (() => void) | null = null;
    const unserveLast = () => {
      unserve?.();
      unserve = null;
    };
    disposables.push({ dispose: unserveLast });
    async function serve(): Promise<void> {
      unserveLast();
      unserve = await engine.serve(bridge);
      if (isClosed()) {
        unserveLast();
        return;
      }
      webview.html = canvasHtml({
        outUri: (file) =>
          webview.asWebviewUri(
            options.extensionUri.with({ path: `${options.extensionUri.path}/out/${file}` }),
          ),
        cspSource: webview.cspSource,
        title: label(),
      });
    }
    await serve();
    if (isClosed()) throw closedEarly(root);
    disposables.push({
      dispose: hold.renewed(guarded(() => `rebooting the canvas of ${label()}`, serve)),
    });

    return {
      root,
      hold,
      panel,
      document,
      save,
      revert,
      declined: () => (unsaved ? workingDigest : undefined),
      drawn: () => drawn,
      tick: () => postEvent(host, { op: 'tick' }),
    };
  }

  // The column a canvas shows in, created (`column` undefined: the active
  // group) or revealed (its own column): a show that takes no focus, as the
  // chat tools' does, goes beside the active text editor whenever showing it
  // there would cover that editor.
  function shownIn(
    preserveFocus: boolean | undefined,
    column: vscode.ViewColumn | undefined,
  ): vscode.ViewColumn | undefined {
    const editor = api.window.activeTextEditor;
    return preserveFocus && editor && (column === undefined || column === editor.viewColumn)
      ? api.ViewColumn.Beside
      : column;
  }

  // The editors being resolved, by document: an `ensure` for a root whose
  // editor is being resolved, by it or by VS Code (a tab restored on reload),
  // waits for that resolve and opens nothing, so one root makes one panel. A
  // slot is settled when the resolve ends, and gone then.
  type Slot = {
    promise: Promise<Entry>;
    resolve: (entry: Entry) => void;
    reject: (error: unknown) => void;
    // Whether an `ensure` waits on it, and would hear a failure.
    awaited: boolean;
    // Whether VS Code has started resolving the editor.
    resolving: boolean;
  };
  const slots = new Map<string, Slot>();
  function slotOf(key: string): Slot {
    const known = slots.get(key);
    if (known) return known;
    let resolve!: Slot['resolve'];
    let reject!: Slot['reject'];
    const promise = new Promise<Entry>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    const slot: Slot = { promise, resolve, reject, awaited: false, resolving: false };
    slots.set(key, slot);
    const gone = () => {
      if (slots.get(key) === slot) slots.delete(key);
    };
    promise.then(gone, gone);
    return slot;
  }

  // The entry of a document, waiting for it when its editor is still being
  // resolved: what VS Code asks of the document in that window is asked of
  // the editor once it exists. A document with no editor has no entry.
  async function entryFor(document: vscode.CustomDocument): Promise<Entry | undefined> {
    const known = entryOf(document);
    if (known) return known;
    return slots.get(canvasKey(document.uri))?.promise.catch(() => undefined);
  }

  // What VS Code asks of a canvas's document and editor.
  const provider: vscode.CustomEditorProvider<LaceCanvasDocument> = {
    onDidChangeCustomDocument: changed.event,
    openCustomDocument(uri) {
      const root = rootOfPath(
        api.workspace.workspaceFolders ?? [],
        uri.with({ scheme: 'file' }).fsPath,
      );
      return Promise.resolve({ uri, root, dispose: () => {} });
    },
    async resolveCustomEditor(document, panel) {
      // A canvas whose folder left the workspace (a tab restored on reload)
      // has no session to hold: its tab closes.
      const { root } = document;
      if (!root) {
        panel.dispose();
        return;
      }
      const slot = slotOf(canvasKey(document.uri));
      slot.resolving = true;
      try {
        slot.resolve(await attach(document, root, panel));
      } catch (error) {
        if (!slot.awaited) report(`opening the canvas of ${labelOf(root)}`, error);
        slot.reject(error);
      }
    },
    async saveCustomDocument(document) {
      await (await entryFor(document))?.save();
    },
    saveCustomDocumentAs: () =>
      Promise.reject(new Error('A Lace canvas is saved where it is: it has no Save As.')),
    async revertCustomDocument(document) {
      await (await entryFor(document))?.revert();
    },
    backupCustomDocument: () =>
      Promise.reject(new Error('Unsaved canvas edits are held by the engine, not backed up.')),
  };
  const registration = api.window.registerCustomEditorProvider(CANVAS_VIEW_TYPE, provider, {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: false,
  });

  return {
    async ensure(root, { preserveFocus } = {}) {
      const existing = panels.find((entry) => sameRoot(entry.root, root));
      if (existing) {
        existing.panel.reveal(shownIn(preserveFocus, existing.panel.viewColumn), preserveFocus);
        return existing;
      }
      const at = canvasUri(root);
      const key = canvasKey(at);
      let slot = slots.get(key);
      if (!slot) {
        const opening = slotOf(key);
        slot = opening;
        const viewColumn = shownIn(preserveFocus, undefined) ?? api.ViewColumn.Active;
        Promise.resolve(
          api.commands.executeCommand('vscode.openWith', at, CANVAS_VIEW_TYPE, {
            viewColumn,
            preserveFocus: preserveFocus ?? false,
          }),
        ).then(() => {
          // VS Code opened nothing it resolved an editor for: nothing will
          // settle the slot.
          if (!opening.resolving) {
            opening.reject(new Error(`VS Code did not open the canvas of ${labelOf(root)}.`));
          }
        }, opening.reject);
      }
      slot.awaited = true;
      return slot.promise;
    },
    activeRoot: () => panels.find((entry) => entry.panel.active)?.root,
    roots: () => panels.map((entry) => entry.root),
    drawnDigest: (path) => panels.find((entry) => rootPath(entry.root) === path)?.drawn(),
    onDidChangeActive(listener) {
      activated.add(listener);
      return () => activated.delete(listener);
    },
    tick(root) {
      panels.find((entry) => sameRoot(entry.root, root))?.tick();
    },
    dispose() {
      for (const entry of [...panels]) entry.panel.dispose();
      registration.dispose();
      changed.dispose();
    },
  };
}
