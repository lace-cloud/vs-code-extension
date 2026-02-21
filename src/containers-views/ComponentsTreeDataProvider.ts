import * as vscode from 'vscode';
import { Store } from '../persistence';

export class ComponentsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<void | null> = new vscode.EventEmitter<
    void | null
  >();
  readonly onDidChangeTreeData: vscode.Event<void | null> = this._onDidChangeTreeData.event;

  constructor(private readonly store: Store) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }

  async getTreeItem(element: vscode.TreeItem): Promise<vscode.TreeItem> {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      const components = this.store.listComponents();
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
