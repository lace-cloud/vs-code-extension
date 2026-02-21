import * as vscode from 'vscode';

export class TemplatesTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<void | null> = new vscode.EventEmitter<
    void | null
  >();
  readonly onDidChangeTreeData: vscode.Event<void | null> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    return [
      new vscode.TreeItem('VPC Template', vscode.TreeItemCollapsibleState.None),
      new vscode.TreeItem('EC2 Instance Template', vscode.TreeItemCollapsibleState.None),
    ];
  }
}
