import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem | undefined;

export function updateStatusBar(): void {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.show();
  }

  statusBarItem.text = '$(circuit-board) Lace';
  statusBarItem.tooltip = 'Lace Extension';
}
