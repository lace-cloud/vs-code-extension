import * as vscode from 'vscode';
import * as path from 'path';
import type { LaceTransport, RegistryModule, CanvasView } from '@lace/host';
import { ChatController } from './controller';

/** External deps provided by the extension — everything the controller needs except getCanvasView. */
export type ChatSidebarDeps = {
  getRpcClient: () => LaceTransport | null;
  getRegistryModules: () => RegistryModule[];
  getUserOrgs: () => Array<{ slug: string; name: string; role: string }>;
  getLaceDir: () => string | undefined;
};

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'laceChat';

  private controller: ChatController | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly externalDeps: ChatSidebarDeps,
    private readonly log: (msg: string) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'out')),
        vscode.Uri.joinPath(this.context.extensionUri, 'images'),
      ],
    };
    view.webview.html = getWebviewContent(this.context, view.webview);

    // Create controller first, then wire deps.getCanvasView to its cache.
    // The lazy arrow captures `this.controller` at call time, so it resolves
    // after the controller is assigned.
    let controller: ChatController;
    const deps = {
      ...this.externalDeps,
      getCanvasView: () => controller?.getLatestView() ?? null,
    };
    controller = new ChatController(this.context, view.webview, deps, this.log);
    this.controller = controller;

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

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).substring(2, 15);
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'out', 'chat-sidebar.js')),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lace Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
