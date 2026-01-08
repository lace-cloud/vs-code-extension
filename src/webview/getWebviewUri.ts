import * as vscode from 'vscode';
import * as path from 'path';

export function getWebviewUri(
  context: vscode.ExtensionContext,
  fileName: string,
  webview: vscode.Webview
): vscode.Uri {
  const filePath = vscode.Uri.file(path.join(context.extensionPath, 'images', fileName));
  console.log(`----${filePath}`);
  return webview.asWebviewUri(filePath);
}
