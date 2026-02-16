import * as vscode from 'vscode';

export type RegistrySystem = 'aws' | 'azure' | 'gcp';

export class RegistrySelectorProvider implements vscode.TreeDataProvider<RegistryItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private getSystem: () => RegistrySystem,
    private setSystem: (s: RegistrySystem) => void,
  ) {}

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item: RegistryItem): vscode.TreeItem {
    return item;
  }

  getChildren(): RegistryItem[] {
    const active = this.getSystem();

    return [
      new RegistryItem('AWS', 'aws', active === 'aws'),
      new RegistryItem('Azure', 'azure', active === 'azure'),
      new RegistryItem('GCP', 'gcp', active === 'gcp'),
    ];
  }
}

class RegistryItem extends vscode.TreeItem {
  constructor(label: string, system: RegistrySystem, active: boolean) {
    super(label, vscode.TreeItemCollapsibleState.None);

    this.command = {
      command: 'registry.selectSystem',
      title: 'Select Registry',
      arguments: [system],
    };

    // radio-style icons
    this.iconPath = new vscode.ThemeIcon(active ? 'circle-filled' : 'circle-outline');
  }
}
