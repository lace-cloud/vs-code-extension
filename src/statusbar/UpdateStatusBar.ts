import * as vscode from 'vscode';
import { getAuthenticationStatus } from '../auth/AuthenticationLace';

let statusBarItem: vscode.StatusBarItem | undefined;

export function updateStatusBar(): void {
  const isAuthenticated = getAuthenticationStatus();

  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'lace.connect';
    statusBarItem.show();
  }

  if (isAuthenticated) {
    statusBarItem.text = '$(check) Connected to Lace';
    statusBarItem.tooltip = 'You are connected to Lace';
    statusBarItem.color = 'green';
  } else {
    statusBarItem.text = '$(debug-disconnect) Connect to Lace';
    statusBarItem.tooltip = 'Click to connect to Lace';
    statusBarItem.color = 'gray';
  }
}
