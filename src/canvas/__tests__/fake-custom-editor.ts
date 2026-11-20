// VS Code's custom editors as the canvas panels meet them: the panel VS Code
// makes for an editor, the provider registered for `lace.canvas`, and
// `vscode.openWith`, which opens the document named and resolves the editor
// on a panel of its own.
import { vi } from 'vitest';
import type * as vscode from 'vscode';
import { Emitter } from '../../vscode/__tests__/fake-emitter';
import { CANVAS_VIEW_TYPE, type LaceCanvasDocument } from '../canvas-panels';

export type CanvasProvider = vscode.CustomEditorProvider<LaceCanvasDocument>;
type Listener = (m: unknown) => void;

// The input of a custom editor's tab.
export class TabInputCustom {
  constructor(
    readonly uri: vscode.Uri,
    readonly viewType: string,
  ) {}
}

// A macrotask: what VS Code takes between a save or revert resolving and
// the document it clears showing clean.
export const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// A panel as VS Code makes one: once disposed it no longer hands out its
// webview, and its webview delivers nothing posted to it.
export function fakePanel() {
  const listeners = new Set<Listener>();
  const posted: unknown[] = [];
  let disposed = false;
  let onDispose = () => {};
  let onViewState = () => {};
  // As the real webview: it refuses its HTML once its panel is disposed.
  let html = '';
  const webview = {
    get html() {
      return html;
    },
    set html(value: string) {
      if (disposed) throw new Error('Webview is disposed');
      html = value;
    },
    cspSource: 'vscode-webview://csp',
    asWebviewUri: (u: { path: string }) => `webview://${u.path}`,
    postMessage: async (message: unknown) => {
      if (disposed) return false;
      posted.push(message);
      return true;
    },
    onDidReceiveMessage: (listener: Listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  const panel = {
    title: '',
    active: false,
    visible: true,
    viewColumn: 1 as number | undefined,
    reveal: vi.fn(),
    dispose: () => {
      disposed = true;
      onDispose();
    },
    onDidDispose: (listener: () => void) => {
      onDispose = listener;
      return { dispose: () => {} };
    },
    onDidChangeViewState: (listener: () => void) => {
      onViewState = listener;
      return { dispose: () => {} };
    },
    get webview() {
      if (disposed) throw new Error('Webview is disposed');
      return webview;
    },
  };
  return {
    panel,
    posted,
    disposed: () => disposed,
    // What the page sends.
    receive: (message: unknown) => {
      for (const listener of [...listeners]) listener(message);
    },
    activate: () => {
      panel.active = true;
      onViewState();
    },
  };
}

// The pieces of the VS Code API a canvas's custom editor uses. `opened` is
// told the options of each `vscode.openWith`, before the document opens.
export function customEditors(opened: (show: { preserveFocus: boolean }) => void = () => {}) {
  let provider!: CanvasProvider;
  const panels: ReturnType<typeof fakePanel>[] = [];
  const documents: LaceCanvasDocument[] = [];
  // What VS Code keeps of each document: dirty from a change event, clear
  // one macrotask after the save or revert it asked for has resolved, and the
  // tabs are told then. A change event fired while that is pending is applied,
  // and then cleared with the rest.
  const dirty = new Set<string>();
  const tabChanges = new Emitter<void>();
  const keyOf = (document: LaceCanvasDocument) => document.uri.toString();
  const cleared = async (document: LaceCanvasDocument) => {
    await macrotask();
    dirty.delete(keyOf(document));
    tabChanges.fire();
  };
  return {
    panels,
    documents,
    provider: () => provider,
    isDirty: (document: LaceCanvasDocument) => dirty.has(keyOf(document)),
    // Save and Revert as VS Code runs them.
    async save(document: LaceCanvasDocument) {
      await provider.saveCustomDocument(document, undefined as never);
      await cleared(document);
    },
    async revert(document: LaceCanvasDocument) {
      await provider.revertCustomDocument(document, undefined as never);
      await cleared(document);
    },
    TabInputCustom,
    window: {
      tabGroups: {
        get all() {
          return [
            {
              tabs: documents.map((document) => ({
                input: new TabInputCustom(document.uri, CANVAS_VIEW_TYPE),
                isDirty: dirty.has(keyOf(document)),
              })),
            },
          ];
        },
        onDidChangeTabs: tabChanges.event,
      },
      registerCustomEditorProvider: vi.fn((_type: string, registered: CanvasProvider) => {
        provider = registered;
        registered.onDidChangeCustomDocument(((e: { document: LaceCanvasDocument }) => {
          dirty.add(keyOf(e.document));
          tabChanges.fire();
        }) as never);
        return { dispose: () => {} };
      }),
    },
    commands: {
      executeCommand: vi.fn(
        async (
          _command: string,
          at: vscode.Uri,
          _type: string,
          show: { preserveFocus: boolean },
        ) => {
          opened(show);
          const document = await provider.openCustomDocument(at, {} as never, undefined as never);
          documents.push(document);
          const made = fakePanel();
          panels.push(made);
          await provider.resolveCustomEditor(document, made.panel as never, undefined as never);
        },
      ),
    },
    EventEmitter: Emitter,
  };
}
