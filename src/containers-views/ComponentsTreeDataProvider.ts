import * as vscode from 'vscode';
import { getAuthenticationStatus } from '../auth/AuthenticationLace';
import { getComponents } from '../database';

// export class ComponentsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
//   private _onDidChangeTreeData: vscode.EventEmitter<void | null> = new vscode.EventEmitter<void | null>();
//   readonly onDidChangeTreeData: vscode.Event<void | null> = this._onDidChangeTreeData.event;

//   refresh(): void {
//     this._onDidChangeTreeData.fire(null);
//   }

//   getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
//     return element;
//   }

//   async getChildren(): Promise<vscode.TreeItem[]> {
//     const isAuthenticated = getAuthenticationStatus();
//     if (!isAuthenticated) {
//       const loginItem = new vscode.TreeItem('Connect to Lace', vscode.TreeItemCollapsibleState.None);
//       loginItem.iconPath = new vscode.ThemeIcon('plug');
//       loginItem.command = {
//         command: 'lace.connect',
//         title: 'Connect to Lace',
//       };
//       return [loginItem];
//     }
//     return [
//       new vscode.TreeItem('Component A', vscode.TreeItemCollapsibleState.None),
//       new vscode.TreeItem('Component B', vscode.TreeItemCollapsibleState.None),
//     ];
//   }
// }

///////////////////////

export class ComponentsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<void | null> = new vscode.EventEmitter<
    void | null
  >();
  readonly onDidChangeTreeData: vscode.Event<void | null> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }

  async getTreeItem(element: vscode.TreeItem): Promise<vscode.TreeItem> {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      // Check if the user is authenticated
      const isAuthenticated = getAuthenticationStatus();
      if (!isAuthenticated) {
        const loginItem = new vscode.TreeItem(
          'Connect to Lace',
          vscode.TreeItemCollapsibleState.None,
        );
        loginItem.iconPath = new vscode.ThemeIcon('plug');
        loginItem.command = {
          command: 'lace.connect',
          title: 'Connect to Lace',
        };
        return [loginItem];
      }

      // Fetch components only if the user is authenticated
      const components = await getComponents();
      if (components.length === 0) {
        return [
          new vscode.TreeItem('No components available', vscode.TreeItemCollapsibleState.None),
        ];
      }
      return components.map((component) => {
        const item = new vscode.TreeItem(component.name, vscode.TreeItemCollapsibleState.None);
        item.command = {
          command: 'components.openComponent',
          title: 'Open Component',
          arguments: [component.name],
        };
        return item;
      });
    }
    return [];
  }
}
