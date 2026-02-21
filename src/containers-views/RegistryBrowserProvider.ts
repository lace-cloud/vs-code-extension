// src/containers-views/RegistryBrowserProvider.ts
import * as vscode from 'vscode';
import type { JSONRPCClient } from '../utilities/engine/rpc-client';

// ── Types ──

export type RegistryModule = {
  id: string;
  name: string;
  system: string;
  version: string;
  kind: 'leaf' | 'composite';
  categories?: string[];
  description?: string;
};

type TreeNode =
  | { type: 'system'; system: string }
  | { type: 'category'; system: string; category: string }
  | { type: 'module'; module: RegistryModule };

// ── Provider ──

export class RegistryBrowserProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private modules: RegistryModule[] = [];
  private loading = false;
  private rpcClient: JSONRPCClient | null = null;

  setRpcClient(client: JSONRPCClient | null) {
    this.rpcClient = client;
  }

  async refresh() {
    if (!this.rpcClient) {
      this.modules = [];
      this._onDidChangeTreeData.fire();
      return;
    }

    this.loading = true;
    this._onDidChangeTreeData.fire();

    try {
      // Fetch all systems in parallel
      const [aws, azure, gcp] = await Promise.allSettled([
        this.rpcClient.listRegistryModules({ system: 'aws' }),
        this.rpcClient.listRegistryModules({ system: 'azure' }),
        this.rpcClient.listRegistryModules({ system: 'gcp' }),
      ]);

      this.modules = [];
      for (const result of [aws, azure, gcp]) {
        if (result.status === 'fulfilled' && result.value?.modules) {
          this.modules.push(...(result.value.modules as RegistryModule[]));
        }
      }
    } catch (err: any) {
      console.warn('Failed to fetch registry:', err.message);
      this.modules = [];
    }

    this.loading = false;
    this._onDidChangeTreeData.fire();
  }

  /** Get all loaded modules (for command palette quick pick). */
  getModules(): RegistryModule[] {
    return this.modules;
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.type) {
      case 'system': {
        const item = new vscode.TreeItem(
          node.system.toUpperCase(),
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new vscode.ThemeIcon('cloud');
        item.contextValue = 'registrySystem';
        return item;
      }

      case 'category': {
        const item = new vscode.TreeItem(node.category, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('symbol-folder');
        item.contextValue = 'registryCategory';
        return item;
      }

      case 'module': {
        const m = node.module;
        const label = `${m.name}`;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.description = `v${m.version}`;
        item.tooltip = new vscode.MarkdownString(
          [
            `**${m.name}** v${m.version}`,
            ``,
            `System: ${m.system}`,
            `Kind: ${m.kind}`,
            m.description ? `\n${m.description}` : '',
          ].join('\n'),
        );
        item.iconPath = new vscode.ThemeIcon(
          m.kind === 'composite' ? 'symbol-package' : 'symbol-module',
        );
        item.contextValue = 'registryModule';

        // Single click → show detail (future: open detail view)
        item.command = {
          command: 'lace.showModuleDetail',
          title: 'Show Module Detail',
          arguments: [m],
        };

        return item;
      }
    }
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (this.loading) {
      return [];
    }

    // Root level → system nodes
    if (!node) {
      const systems = [...new Set(this.modules.map((m) => m.system))].sort();
      if (systems.length === 0) {
        return [];
      }
      return systems.map((s) => ({ type: 'system' as const, system: s }));
    }

    // System level → category nodes
    if (node.type === 'system') {
      const systemModules = this.modules.filter((m) => m.system === node.system);
      const categories = new Set<string>();
      for (const m of systemModules) {
        if (m.categories && m.categories.length > 0) {
          m.categories.forEach((c) => categories.add(c));
        } else {
          categories.add('misc');
        }
      }
      return [...categories]
        .sort()
        .map((c) => ({ type: 'category' as const, system: node.system, category: c }));
    }

    // Category level → module nodes
    if (node.type === 'category') {
      const categoryModules = this.modules.filter(
        (m) =>
          m.system === node.system &&
          (m.categories?.includes(node.category) ||
            (!m.categories?.length && node.category === 'misc')),
      );
      // Deduplicate by id
      const seen = new Set<string>();
      const unique = categoryModules.filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
      return unique
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => ({ type: 'module' as const, module: m }));
    }

    return [];
  }
}
