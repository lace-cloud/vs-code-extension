import * as path from 'node:path';
import type { CanvasView } from '@lace-cloud/proto';
import * as vscode from 'vscode';
import { ChatController, type ChatSidebarDeps } from './controller';

// The HTML scaffold (CSP, nonce, script tag) is built by the
// extension shell — chat-sidebar receives a webview-bound builder
// at construction time. Keeps this package free of vscode-coupled
// host primitives and lets the JetBrains adapter supply its own.
export type BuildWebviewHtml = (webview: vscode.Webview) => string;

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'laceChat';

  private controller: ChatController | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly externalDeps: ChatSidebarDeps,
    private readonly buildHtml: BuildWebviewHtml,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'out')),
        vscode.Uri.joinPath(this.context.extensionUri, 'images'),
      ],
    };
    view.webview.html = this.buildHtml(view.webview);

    const controller = new ChatController(this.context, view.webview, this.externalDeps);
    this.controller = controller;
    void controller.init();

    view.onDidDispose(() => {
      this.controller?.dispose();
      this.controller = null;
    });
  }

  async clearHistory(): Promise<void> {
    await this.controller?.clearHistory();
  }

  /** Exposes the controller's cached canvas view for tool deps. */
  getLatestView(): CanvasView | null {
    return this.controller?.getLatestView() ?? null;
  }
}

export type { ChatSidebarDeps } from './controller';
