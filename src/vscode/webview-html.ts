import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

export type WebviewHtmlOptions = {
  /** Filename of the bundled webview script in `out/` (e.g. 'webview.js' or 'chat-sidebar.js'). */
  scriptFilename: string;
  /** HTML <title> content. */
  title: string;
  /** Optional inline <style> content inserted in <head>. */
  bodyStyle?: string;
  /** Optional inline <script> inserted before the main bundle — e.g. for keyboard shortcut handlers. */
  prebodyScript?: string;
};

/**
 * Builds the HTML document served by a VS Code webview. Shared between the
 * canvas panel and the chat sidebar — both load a single bundled React app
 * and need the same CSP + nonce pattern.
 */
export function buildWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  options: WebviewHtmlOptions,
): string {
  // CSP nonces must be unpredictable. Math.random() isn't
  // cryptographically strong; randomBytes is the right primitive.
  const nonce = randomBytes(16).toString('hex');
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'out', options.scriptFilename)),
  );
  const styleBlock = options.bodyStyle ? `<style>${options.bodyStyle}</style>` : '';
  const prebodyBlock = options.prebodyScript
    ? `<script nonce="${nonce}">${options.prebodyScript}</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${options.title}</title>
  ${styleBlock}
</head>
<body>
  <div id="root"></div>
  ${prebodyBlock}
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
