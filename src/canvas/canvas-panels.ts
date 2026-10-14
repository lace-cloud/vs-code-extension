// The canvas panels: one webview panel per authoring root, and the one
// long-lived holder of that root's session. `ensure` is the one way a panel
// comes to exist; it takes the hold when the panel is created, before the
// page boots, and resolves once the hold exists. A panel whose first boot
// cannot be served closes, giving its hold back. Every editing entry point
// that is not the canvas itself calls it first, so no edit is ever made by
// the last holder.
//
// The page reaches the engine over the bridge the panel serves and the host
// over the host protocol, both on the panel's one postMessage pair. When the
// hold's session is opened again after an end, the panel disposes the bridge
// it served and serves a new one, and assigns new HTML: the page boots again
// through its one path.
//
// The page boots with the stack picked for its root, and hears each later
// pick and each tick (a run the host started settled) as an event; it
// reports its focus, which the autosave policy reads. A notice the page
// sends is shown with the ways out the failure it carries names; its
// Validate validates the panel's root. The canvas's own Generate ends with
// the notice Lace: Generate shows, Show Changes among it. Open source on a
// Diagnostics row asks the host to open a file of the root at a line and
// column, in the editor beside the canvas.
import type * as vscode from 'vscode';
import { positionOf } from '../diagnostics/problems';
import type { Engine } from '../engine/engine';
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
  fileUri,
  rootPath,
  rootTitle,
  rootUri,
  sameRoot,
} from '../roots/authoring-roots';
import type { RootState } from '../state/root-state';
import { type OfferActions, notice as showNotice } from '../vscode/offers';
import { canvasHtml } from '../vscode/webview-html';

export const CANVAS_VIEW_TYPE = 'lace.canvas';

type PanelsApi = {
  window: Pick<
    typeof vscode.window,
    | 'createWebviewPanel'
    | 'showInformationMessage'
    | 'showWarningMessage'
    | 'showErrorMessage'
    | 'showTextDocument'
  >;
  workspace: Pick<typeof vscode.workspace, 'openTextDocument' | 'workspaceFolders'>;
  ViewColumn: Pick<typeof vscode.ViewColumn, 'Active' | 'Beside'>;
  Range: typeof vscode.Range;
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
  // What a notice from a page offers, and Validate on a root.
  offers: OfferActions;
  validate: (root: AuthoringRoot) => Promise<void>;
  // What the page's own Generate that wrote `written` shows.
  generated: (root: AuthoringRoot, written: readonly string[]) => Promise<void>;
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
    offers,
    validate,
    generated,
    report,
  } = options;
  const panels: Entry[] = [];
  const activated = new Set<(root: AuthoringRoot) => void>();

  type Entry = CanvasPanel & { tick: () => void };

  // Something an observer does, with its failure reported and not thrown
  // into the stream that called it.
  const guarded =
    <A extends unknown[]>(what: string, run: (...args: A) => void | Promise<void>) =>
    (...args: A): void => {
      try {
        const result = run(...args);
        if (result instanceof Promise) result.catch((error) => report(what, error));
      } catch (error) {
        report(what, error);
      }
    };

  // Takes the root's hold, then makes its panel. From the hold on, the
  // panel's close is the one way what the panel set up goes: every
  // subscription, the bridge and the hold. A panel that could not be opened
  // (its first serve failed) is closed, and `create` rejects.
  async function create(root: AuthoringRoot, preserveFocus: boolean | undefined): Promise<Entry> {
    const label = rootTitle(root, api.workspace.workspaceFolders ?? []);
    const hold = await rootSessions.acquire(rootPath(root));
    const disposables: vscode.Disposable[] = [];
    const close = guarded(`closing the canvas of ${label}`, async () => {
      pageFocus(hold.sessionId, false);
      for (const disposable of disposables) disposable.dispose();
      await hold.release();
    });
    let panel: vscode.WebviewPanel;
    try {
      panel = api.window.createWebviewPanel(
        CANVAS_VIEW_TYPE,
        label,
        { viewColumn: api.ViewColumn.Active, preserveFocus: preserveFocus ?? false },
        { enableScripts: true, retainContextWhenHidden: true },
      );
    } catch (error) {
      close();
      throw error;
    }
    panel.onDidDispose(() => {
      const at = panels.findIndex((entry) => entry.panel === panel);
      if (at >= 0) panels.splice(at, 1);
      close();
    });
    try {
      return await opened(root, label, hold, panel, disposables);
    } catch (error) {
      panel.dispose();
      throw error;
    }
  }

  // Wires a new panel to its page and serves the page its first boot; what
  // it sets up, the bridge it serves among them, goes into `disposables`.
  async function opened(
    root: AuthoringRoot,
    label: string,
    hold: RootHold,
    panel: vscode.WebviewPanel,
    disposables: vscode.Disposable[],
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

    const boot = async (): Promise<Boot> => ({
      root: rootPath(root),
      arrangement: rootState.arrangement(root),
      stack: rootState.stack(root),
    });
    const notice = guarded('a notice from the canvas page', (n: HostNotice) => {
      if (n.op === 'unsaved') panel.title = n.value ? `${label} ●` : label;
      else if (n.op === 'focus') pageFocus(hold.sessionId, n.value);
      else if (n.op === 'arrangement') return rootState.arrange(root, n.value);
      else if (n.op === 'generated') return generated(root, n.written);
      else {
        const actions = { ...offers, validate: () => validate(root) };
        return showNotice(api, actions, n.level, n.text, n.failure).then(() => {});
      }
    });
    const openSource = async ({ file, line, column }: SourceLocation): Promise<null> => {
      const [at, character] = positionOf({ line, column });
      try {
        const document = await api.workspace.openTextDocument(fileUri(root, file));
        await api.window.showTextDocument(document, {
          viewColumn: api.ViewColumn.Beside,
          selection: new api.Range(at, character, at, character),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Lace could not open ${file} in ${label}: ${reason}`);
      }
      return null;
    };
    disposables.push({ dispose: serveHost(host, { boot, confirm, openSource, notice }) });
    disposables.push({
      dispose: rootState.onDidPickStack(
        root,
        guarded(`telling the canvas of ${label} its stack`, (stack) => {
          postEvent(host, { op: 'stack', value: stack });
        }),
      ),
    });
    disposables.push(
      panel.onDidChangeViewState(
        guarded(`the canvas of ${label} becoming active`, () => {
          if (!panel.active) return;
          for (const listener of [...activated]) listener(root);
        }),
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
      webview.html = canvasHtml({
        outUri: (file) =>
          webview.asWebviewUri(
            options.extensionUri.with({ path: `${options.extensionUri.path}/out/${file}` }),
          ),
        cspSource: webview.cspSource,
        title: label,
      });
    }
    await serve();
    disposables.push({ dispose: hold.renewed(guarded(`rebooting the canvas of ${label}`, serve)) });

    return { root, hold, panel, tick: () => postEvent(host, { op: 'tick' }) };
  }

  // Panels being created, so two `ensure` calls for one root in flight make
  // one panel.
  const creating = new Map<string, Promise<Entry>>();

  return {
    async ensure(root, { preserveFocus } = {}) {
      const existing = panels.find((entry) => sameRoot(entry.root, root));
      if (existing) {
        existing.panel.reveal(undefined, preserveFocus);
        return existing;
      }
      const key = rootUri(root).toString();
      let pending = creating.get(key);
      if (!pending) {
        pending = create(root, preserveFocus).then((entry) => {
          panels.push(entry);
          return entry;
        });
        creating.set(key, pending);
        pending.finally(() => creating.delete(key)).catch(() => {});
      }
      return pending;
    },
    activeRoot: () => panels.find((entry) => entry.panel.active)?.root,
    roots: () => panels.map((entry) => entry.root),
    onDidChangeActive(listener) {
      activated.add(listener);
      return () => activated.delete(listener);
    },
    tick(root) {
      panels.find((entry) => sameRoot(entry.root, root))?.tick();
    },
    dispose() {
      for (const entry of [...panels]) entry.panel.dispose();
    },
  };
}
