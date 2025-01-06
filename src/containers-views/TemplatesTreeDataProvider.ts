import * as vscode from 'vscode';

import { getAuthenticationStatus } from '../auth/AuthenticationLace';

// Global state for authentication
// let isAuthenticated = false;


export class TemplatesTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<void | null> = new vscode.EventEmitter<void | null>();
  readonly onDidChangeTreeData: vscode.Event<void | null> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const isAuthenticated = getAuthenticationStatus();
    if (!isAuthenticated) {
      const loginItem = new vscode.TreeItem('Connect to Lace', vscode.TreeItemCollapsibleState.None);
      loginItem.iconPath = new vscode.ThemeIcon('plug');
      loginItem.command = {
        command: 'lace.connect',
        title: 'Connect to Lace',
      };
      return [loginItem];
    }
    // Example templates when authenticated
    return [
      new vscode.TreeItem('VPC Template', vscode.TreeItemCollapsibleState.None),
      new vscode.TreeItem('EC2 Instance Template', vscode.TreeItemCollapsibleState.None),
    ];
  }
}