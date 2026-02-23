// src/containers-views/RegistrySidebarProvider.ts
import * as vscode from 'vscode';
import type { JSONRPCClient } from '../utilities/engine/rpc-client';
import type { RegistryModule } from '../types/protocol';

// ── Provider ──

export class RegistrySidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'laceRegistry';

  private view?: vscode.WebviewView;
  private modules: RegistryModule[] = [];
  private rpcClient: JSONRPCClient | null = null;
  private loading = false;
  private errorMessage: string | null = null;

  setRpcClient(client: JSONRPCClient | null) {
    this.rpcClient = client;
  }

  /** Get all loaded modules (for command palette quick pick). */
  getModules(): RegistryModule[] {
    return this.modules;
  }

  /** Fetch all modules for a system, paginating until exhausted. */
  private async fetchAllModules(system: string): Promise<RegistryModule[]> {
    if (!this.rpcClient) return [];
    const allModules: RegistryModule[] = [];
    let page = 1;
    const limit = 100;
    while (true) {
      const result = await this.rpcClient.listRegistryModules({ system, page, limit });
      const modules = (result?.modules ?? []) as RegistryModule[];
      allModules.push(...modules);
      if (modules.length < limit) break;
      page++;
    }
    return allModules;
  }

  async refresh() {
    if (!this.rpcClient) {
      this.modules = [];
      this.errorMessage = null;
      this.updateWebview();
      return;
    }

    this.loading = true;
    this.errorMessage = null;
    this.updateWebview();

    const [aws, azure, gcp] = await Promise.allSettled([
      this.fetchAllModules('aws'),
      this.fetchAllModules('azure'),
      this.fetchAllModules('gcp'),
    ]);

    const results = [aws, azure, gcp];
    const failCount = results.filter((r) => r.status === 'rejected').length;

    this.modules = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        this.modules.push(...result.value);
      }
    }

    if (failCount === results.length) {
      this.errorMessage = 'Lace engine is not available. Start it with "Lace: Start Engine".';
      console.warn('All registry fetches failed');
    } else if (failCount > 0) {
      console.warn(`${failCount} registry system(s) failed to load`);
    }

    this.loading = false;
    this.updateWebview();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.command) {
        case 'showDetail':
          vscode.commands.executeCommand('lace.showModuleDetail', msg.module);
          break;
        case 'addToCanvas':
          vscode.commands.executeCommand('lace.addModuleToCanvas', { module: msg.module });
          break;
        case 'refresh':
          vscode.commands.executeCommand('lace.refreshRegistry');
          break;
      }
    });

    this.updateWebview();
  }

  private updateWebview() {
    if (!this.view) return;
    this.view.webview.html = this.buildHtml();
  }

  private buildHtml(): string {
    const modulesJson = JSON.stringify(this.modules);
    const errorJson = JSON.stringify(this.errorMessage);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }

    .search-container {
      padding: 8px 8px 4px;
      position: sticky;
      top: 0;
      background: var(--vscode-sideBar-background);
      z-index: 10;
    }

    .search-input {
      width: 100%;
      padding: 5px 8px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border-radius: 4px;
      font-size: 12px;
      outline: none;
    }

    .search-input:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
    }

    .search-input::placeholder {
      color: var(--vscode-input-placeholderForeground, #888);
    }

    .module-list {
      padding: 0 4px 8px;
    }

    .system-header {
      padding: 6px 8px 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground, #bbb);
      margin-top: 4px;
    }

    .module-item {
      display: flex;
      align-items: flex-start;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      gap: 8px;
    }

    .module-item:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }

    .module-icon {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      border-radius: 4px;
      background: var(--vscode-badge-background, #4d4d4d);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      margin-top: 1px;
    }

    .module-info {
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }

    .module-name {
      font-weight: 600;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--vscode-foreground);
    }

    .module-version {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      margin-left: 4px;
      font-weight: 400;
    }

    .module-categories {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .module-add {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      border-radius: 4px;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      margin-top: 2px;
    }

    .module-item:hover .module-add {
      display: flex;
    }

    .module-add:hover {
      background: var(--vscode-toolbar-hoverBackground, #5a5d5e);
    }

    .empty-state {
      padding: 20px 12px;
      text-align: center;
      color: var(--vscode-descriptionForeground, #888);
      font-size: 12px;
      line-height: 1.5;
    }

    .loading {
      padding: 20px 12px;
      text-align: center;
      color: var(--vscode-descriptionForeground, #888);
      font-size: 12px;
    }

    .result-count {
      padding: 2px 8px 4px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
    }
  </style>
</head>
<body>
  <div class="search-container">
    <input
      class="search-input"
      type="text"
      id="search"
      placeholder="Search Lace Registry"
      autofocus
    />
  </div>
  <div id="content"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const allModules = ${modulesJson};
    const loading = ${this.loading};
    const errorMessage = ${errorJson};

    const searchInput = document.getElementById('search');
    const content = document.getElementById('content');

    function render(filter) {
      if (loading) {
        content.innerHTML = '<div class="loading">Loading registry...</div>';
        return;
      }

      if (errorMessage) {
        content.innerHTML = '<div class="empty-state">' + escHtml(errorMessage) + '</div>';
        return;
      }

      if (allModules.length === 0) {
        content.innerHTML = '<div class="empty-state">No modules available.<br/>Is the Lace engine running?</div>';
        return;
      }

      const q = (filter || '').toLowerCase().trim();
      const filtered = q
        ? allModules.filter(m =>
            m.name.toLowerCase().includes(q) ||
            m.system.toLowerCase().includes(q) ||
            (m.categories || []).some(c => c.toLowerCase().includes(q)) ||
            (m.description || '').toLowerCase().includes(q)
          )
        : allModules;

      if (filtered.length === 0) {
        content.innerHTML = '<div class="empty-state">No modules match "' + escHtml(q) + '"</div>';
        return;
      }

      // Group by system
      const grouped = {};
      filtered.forEach(m => {
        const sys = m.system || 'other';
        if (!grouped[sys]) grouped[sys] = [];
        // Deduplicate by id
        if (!grouped[sys].some(x => x.id === m.id)) {
          grouped[sys].push(m);
        }
      });

      let html = '';
      if (q) {
        html += '<div class="result-count">' + filtered.length + ' module' + (filtered.length !== 1 ? 's' : '') + '</div>';
      }
      html += '<div class="module-list">';

      const systems = Object.keys(grouped).sort();
      for (const sys of systems) {
        html += '<div class="system-header">' + escHtml(sys.toUpperCase()) + '</div>';
        const sorted = grouped[sys].sort((a, b) => a.name.localeCompare(b.name));
        for (const m of sorted) {
          const cats = (m.categories || []).join(', ');
          const idx = allModules.indexOf(m);
          html += '<div class="module-item" data-idx="' + idx + '">';
          html += '  <div class="module-icon">' + (m.kind === 'composite' ? '📦' : '⚙️') + '</div>';
          html += '  <div class="module-info">';
          html += '    <div class="module-name">' + escHtml(m.name) + '<span class="module-version">v' + escHtml(m.version) + '</span></div>';
          if (cats) html += '    <div class="module-categories">' + escHtml(cats) + '</div>';
          html += '  </div>';
          html += '  <button class="module-add" data-add-idx="' + idx + '" title="Add to Canvas">+</button>';
          html += '</div>';
        }
      }

      html += '</div>';
      content.innerHTML = html;

      // Click handlers
      content.querySelectorAll('.module-item').forEach(el => {
        el.addEventListener('click', (e) => {
          // Don't trigger if the + button was clicked
          if (e.target.closest('.module-add')) return;
          const idx = parseInt(el.dataset.idx);
          vscode.postMessage({ command: 'showDetail', module: allModules[idx] });
        });
      });

      content.querySelectorAll('.module-add').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.addIdx);
          vscode.postMessage({ command: 'addToCanvas', module: allModules[idx] });
        });
      });
    }

    function escHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    searchInput.addEventListener('input', () => {
      render(searchInput.value);
    });

    render('');
  </script>
</body>
</html>`;
  }
}
