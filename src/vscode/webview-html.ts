// The HTML a webview page loads: one script and one stylesheet from out/,
// under a CSP that runs only a script carrying this document's nonce. Every
// document is new: a fresh nonce, so assigning it reloads the page.
import { randomBytes } from 'node:crypto';
import type * as vscode from 'vscode';

export type WebviewHtmlInputs = {
  // `webview.asWebviewUri` for a file under the extension's out/.
  outUri: (file: string) => vscode.Uri;
  cspSource: string;
  title: string;
};

// `bundle` names the page's script and stylesheet in out/; `images` are
// the sources its images may load from beside the extension's own.
export function pageHtml(
  { outUri, cspSource, title }: WebviewHtmlInputs,
  { bundle, images }: { bundle: string; images: readonly string[] },
): string {
  const nonce = randomBytes(16).toString('hex');
  const csp = [
    "default-src 'none'",
    `img-src ${[cspSource, ...images].join(' ')}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${outUri(`${bundle}.css`)}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${outUri(`${bundle}.js`)}"></script>
</body>
</html>`;
}

export function canvasHtml(inputs: WebviewHtmlInputs): string {
  return pageHtml(inputs, { bundle: 'canvas-webview', images: ['data:'] });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
