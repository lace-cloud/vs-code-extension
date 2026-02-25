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
  private globalState?: vscode.Memento;
  private favoriteModuleIds: string[] = [];
  private recentModuleIds: string[] = [];

  constructor(globalState?: vscode.Memento) {
    this.globalState = globalState;
    this.favoriteModuleIds = globalState?.get<string[]>('lace.favorites', []) ?? [];
  }

  setRpcClient(client: JSONRPCClient | null) {
    this.rpcClient = client;
  }

  /** Get all loaded modules (for command palette quick pick). */
  getModules(): RegistryModule[] {
    return this.modules;
  }

  /** Track a module as recently used (prepend, deduplicate, cap at 10). */
  trackRecentlyUsed(moduleId: string) {
    this.recentModuleIds = [
      moduleId,
      ...this.recentModuleIds.filter((id) => id !== moduleId),
    ].slice(0, 10);
    this.updateWebview();
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
    webviewView.webview.onDidReceiveMessage(async (msg) => {
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
        case 'toggleFavorite': {
          const id = msg.moduleId as string;
          const idx = this.favoriteModuleIds.indexOf(id);
          if (idx >= 0) {
            this.favoriteModuleIds.splice(idx, 1);
          } else {
            this.favoriteModuleIds.push(id);
          }
          await this.globalState?.update('lace.favorites', this.favoriteModuleIds);
          this.updateWebview();
          break;
        }
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
    const favoritesJson = JSON.stringify(this.favoriteModuleIds);
    const recentJson = JSON.stringify(this.recentModuleIds);

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

    /* ── Category chips ── */
    #chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 6px 8px 2px;
    }

    .chip {
      padding: 2px 8px;
      font-size: 11px;
      border-radius: 10px;
      border: 1px solid var(--vscode-badge-background, #4d4d4d);
      background: transparent;
      color: var(--vscode-descriptionForeground, #888);
      cursor: pointer;
      white-space: nowrap;
    }

    .chip:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }

    .chip.active {
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
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
      user-select: none;
    }

    .module-item:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }

    .module-item.dragging {
      opacity: 0.5;
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
      overflow: hidden;
    }

    .module-icon img {
      width: 100%;
      height: 100%;
      object-fit: contain;
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

    .module-actions {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      margin-top: 2px;
    }

    .module-add, .module-star {
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
    }

    .module-item:hover .module-add,
    .module-item:hover .module-star {
      display: flex;
    }

    .module-star.starred {
      display: flex;
      color: #e2b340;
    }

    .module-add:hover, .module-star:hover {
      background: var(--vscode-toolbar-hoverBackground, #5a5d5e);
    }

    .empty-state {
      padding: 20px 12px;
      text-align: center;
      color: var(--vscode-descriptionForeground, #888);
      font-size: 12px;
      line-height: 1.5;
    }

    .result-count {
      padding: 2px 8px 4px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
    }

    /* ── Retry button ── */
    .retry-btn {
      display: inline-block;
      margin-top: 10px;
      padding: 4px 14px;
      font-size: 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
    }

    .retry-btn:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }

    /* ── Skeleton loading ── */
    .skeleton-group {
      padding: 0 4px;
    }

    .skeleton-header {
      height: 12px;
      width: 50px;
      margin: 10px 8px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background, #4d4d4d);
      opacity: 0.4;
    }

    .skeleton-item {
      display: flex;
      align-items: flex-start;
      padding: 6px 8px;
      gap: 8px;
    }

    .skeleton-icon {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      border-radius: 4px;
      background: linear-gradient(90deg, var(--vscode-badge-background, #4d4d4d) 25%, transparent 50%, var(--vscode-badge-background, #4d4d4d) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    .skeleton-lines {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-top: 2px;
    }

    .skeleton-line {
      height: 10px;
      border-radius: 3px;
      background: linear-gradient(90deg, var(--vscode-badge-background, #4d4d4d) 25%, transparent 50%, var(--vscode-badge-background, #4d4d4d) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    .skeleton-line:first-child { width: 70%; }
    .skeleton-line:last-child { width: 45%; }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
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
  <div id="chips"></div>
  <div id="content"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const allModules = ${modulesJson};
    const loading = ${this.loading};
    const errorMessage = ${errorJson};
    const favoriteIds = ${favoritesJson};
    const recentIds = ${recentJson};

    const searchInput = document.getElementById('search');
    const chipsEl = document.getElementById('chips');
    const content = document.getElementById('content');

    let activeCategories = [];
    let debounceTimer = null;

    // ── Helpers ──

    function escHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function renderModuleItem(m, idx) {
      const cats = (m.categories || []).join(', ');
      const isStarred = favoriteIds.includes(m.id);
      const iconHtml = m.icon_url
        ? '<img src="' + escHtml(m.icon_url) + '" />'
        : (m.kind === 'composite' ? '&#x1F4E6;' : '&#x2699;&#xFE0F;');
      let html = '<div class="module-item" draggable="true" data-idx="' + idx + '">';
      html += '  <div class="module-icon">' + iconHtml + '</div>';
      html += '  <div class="module-info">';
      html += '    <div class="module-name">' + escHtml(m.name) + '<span class="module-version">v' + escHtml(m.version) + '</span></div>';
      if (cats) html += '    <div class="module-categories">' + escHtml(cats) + '</div>';
      html += '  </div>';
      html += '  <div class="module-actions">';
      html += '    <button class="module-star' + (isStarred ? ' starred' : '') + '" data-star-id="' + escHtml(m.id) + '" title="' + (isStarred ? 'Unfavorite' : 'Favorite') + '">' + (isStarred ? '&#x2605;' : '&#x2606;') + '</button>';
      html += '    <button class="module-add" data-add-idx="' + idx + '" title="Add to Canvas">+</button>';
      html += '  </div>';
      html += '</div>';
      return html;
    }

    // ── Category chips ──

    function renderChips(query) {
      if (query || allModules.length === 0) {
        chipsEl.innerHTML = '';
        chipsEl.style.display = 'none';
        return;
      }
      chipsEl.style.display = 'flex';
      const cats = new Set();
      allModules.forEach(m => (m.categories || []).forEach(c => cats.add(c)));
      const sorted = [...cats].sort();
      chipsEl.innerHTML = sorted.map(c => {
        const active = activeCategories.includes(c);
        return '<button class="chip' + (active ? ' active' : '') + '" data-cat="' + escHtml(c) + '">' + escHtml(c) + '</button>';
      }).join('');

      chipsEl.querySelectorAll('.chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const cat = btn.dataset.cat;
          const idx = activeCategories.indexOf(cat);
          if (idx >= 0) activeCategories.splice(idx, 1);
          else activeCategories.push(cat);
          render(searchInput.value);
        });
      });
    }

    // ── Main render ──

    function render(filter) {
      const q = (filter || '').toLowerCase().trim();

      renderChips(q);

      if (loading) {
        content.innerHTML = renderSkeleton();
        return;
      }

      if (errorMessage) {
        content.innerHTML = '<div class="empty-state">' + escHtml(errorMessage) + '<br/><button class="retry-btn" id="retryBtn">Retry</button></div>';
        document.getElementById('retryBtn').addEventListener('click', () => {
          vscode.postMessage({ command: 'refresh' });
        });
        return;
      }

      if (allModules.length === 0) {
        content.innerHTML = '<div class="empty-state">No modules available.<br/>Is the Lace engine running?</div>';
        return;
      }

      const filtered = q
        ? allModules.filter(m =>
            m.name.toLowerCase().includes(q) ||
            m.system.toLowerCase().includes(q) ||
            (m.categories || []).some(c => c.toLowerCase().includes(q)) ||
            (m.description || '').toLowerCase().includes(q)
          )
        : activeCategories.length > 0
          ? allModules.filter(m =>
              (m.categories || []).some(c => activeCategories.includes(c))
            )
          : allModules;

      if (filtered.length === 0) {
        const msg = q ? 'No modules match "' + escHtml(q) + '"' : 'No modules match selected categories';
        content.innerHTML = '<div class="empty-state">' + msg + '</div>';
        return;
      }

      let html = '';

      // Favorites & recently used (only when no search active)
      if (!q && activeCategories.length === 0) {
        const favModules = favoriteIds.map(id => allModules.find(m => m.id === id)).filter(Boolean);
        const recModules = recentIds.map(id => allModules.find(m => m.id === id)).filter(Boolean);

        if (favModules.length > 0) {
          html += '<div class="module-list">';
          html += '<div class="system-header">&#x2605; FAVORITES</div>';
          favModules.forEach(m => {
            html += renderModuleItem(m, allModules.indexOf(m));
          });
          html += '</div>';
        }

        if (recModules.length > 0) {
          html += '<div class="module-list">';
          html += '<div class="system-header">&#x1F552; RECENTLY USED</div>';
          recModules.forEach(m => {
            html += renderModuleItem(m, allModules.indexOf(m));
          });
          html += '</div>';
        }
      }

      // Group by system
      const grouped = {};
      filtered.forEach(m => {
        const sys = m.system || 'other';
        if (!grouped[sys]) grouped[sys] = [];
        if (!grouped[sys].some(x => x.id === m.id)) {
          grouped[sys].push(m);
        }
      });

      if (q) {
        html += '<div class="result-count">' + filtered.length + ' module' + (filtered.length !== 1 ? 's' : '') + '</div>';
      }
      html += '<div class="module-list">';

      const systems = Object.keys(grouped).sort();
      for (const sys of systems) {
        html += '<div class="system-header">' + escHtml(sys.toUpperCase()) + '</div>';
        const sorted = grouped[sys].sort((a, b) => a.name.localeCompare(b.name));
        for (const m of sorted) {
          html += renderModuleItem(m, allModules.indexOf(m));
        }
      }

      html += '</div>';
      content.innerHTML = html;

      attachHandlers();
    }

    function renderSkeleton() {
      let html = '';
      for (let g = 0; g < 3; g++) {
        html += '<div class="skeleton-group">';
        html += '  <div class="skeleton-header"></div>';
        for (let i = 0; i < 4; i++) {
          html += '  <div class="skeleton-item">';
          html += '    <div class="skeleton-icon"></div>';
          html += '    <div class="skeleton-lines">';
          html += '      <div class="skeleton-line"></div>';
          html += '      <div class="skeleton-line"></div>';
          html += '    </div>';
          html += '  </div>';
        }
        html += '</div>';
      }
      return html;
    }

    // ── Event handlers ──

    function attachHandlers() {
      // Click to show detail
      content.querySelectorAll('.module-item').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.module-add') || e.target.closest('.module-star')) return;
          const idx = parseInt(el.dataset.idx);
          vscode.postMessage({ command: 'showDetail', module: allModules[idx] });
        });
      });

      // Add to canvas button
      content.querySelectorAll('.module-add').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.addIdx);
          vscode.postMessage({ command: 'addToCanvas', module: allModules[idx] });
        });
      });

      // Favorite star button
      content.querySelectorAll('.module-star').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ command: 'toggleFavorite', moduleId: btn.dataset.starId });
        });
      });

      // Drag-and-drop
      content.querySelectorAll('.module-item').forEach(el => {
        el.addEventListener('dragstart', (e) => {
          el.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/plain', el.dataset.idx);
        });
        el.addEventListener('dragend', (e) => {
          el.classList.remove('dragging');
          // If cursor left the webview (coordinates reset to 0,0), add to canvas
          if (e.clientX === 0 && e.clientY === 0) {
            const idx = parseInt(el.dataset.idx);
            vscode.postMessage({ command: 'addToCanvas', module: allModules[idx] });
          }
        });
      });
    }

    // ── Search with debounce ──

    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => render(searchInput.value), 150);
    });

    render('');
  </script>
</body>
</html>`;
  }
}
