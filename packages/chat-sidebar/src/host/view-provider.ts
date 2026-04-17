import * as path from 'node:path';
import { buildWebviewHtml, type CanvasView } from '@lace/host';
import * as vscode from 'vscode';
import { ChatController, type ChatSidebarDeps } from './controller';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'laceChat';

  private controller: ChatController | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly externalDeps: ChatSidebarDeps,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'out')),
        vscode.Uri.joinPath(this.context.extensionUri, 'images'),
      ],
    };
    view.webview.html = buildWebviewHtml(this.context, view.webview, {
      scriptFilename: 'chat-sidebar.js',
      title: 'Lace Chat',
    });

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
