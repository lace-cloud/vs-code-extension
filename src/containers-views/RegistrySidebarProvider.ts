// src/containers-views/RegistrySidebarProvider.ts
import * as vscode from 'vscode';
import type { LaceClient } from '../utilities/engine/grpc-client';
import type { RegistryModule } from '../types/protocol';

// ── Constants ──

const MAX_PAGES_PER_SYSTEM = 10;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Provider ──

export class RegistrySidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'laceRegistry';

  private view?: vscode.WebviewView;
  private modules: RegistryModule[] = [];
  private rpcClient: LaceClient | null = null;
  private loading = false;
  private errorMessage: string | null = null;
  private authenticated = false;
  private globalState?: vscode.Memento;
  private favoriteModuleIds: string[] = [];
  private recentModuleIds: string[] = [];
  private cache = new Map<string, { modules: RegistryModule[]; fetchedAt: number }>();
  private outputChannel: vscode.OutputChannel | null = null;

  constructor(globalState?: vscode.Memento, outputChannel?: vscode.OutputChannel) {
    this.globalState = globalState;
    this.outputChannel = outputChannel ?? null;
    this.favoriteModuleIds = globalState?.get<string[]>('lace.favorites', []) ?? [];
  }

  setRpcClient(client: LaceClient | null) {
    this.rpcClient = client;
  }

  setAuthenticated(value: boolean) {
    this.authenticated = value;
    this.updateWebview();
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

  /** Fetch modules for a system with page cap, using cache when fresh. */
  private async fetchAllModules(system: string, force = false): Promise<RegistryModule[]> {
    if (!this.rpcClient) return [];

    const cached = this.cache.get(system);
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      this.outputChannel?.appendLine(
        `[registry] ${system}: cache hit (${cached.modules.length} modules, age ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s)`,
      );
      return cached.modules;
    }

    const start = Date.now();
    const allModules: RegistryModule[] = [];
    let page = 1;
    const limit = 100;
    while (page <= MAX_PAGES_PER_SYSTEM) {
      const result = await this.rpcClient.listRegistryModules({ system, page, limit });
      const modules = (result?.modules ?? []) as RegistryModule[];
      allModules.push(...modules);
      if (modules.length < limit) break;
      page++;
    }

    const elapsed = Date.now() - start;
    this.outputChannel?.appendLine(
      `[registry] ${system}: ${allModules.length} modules in ${page} page(s) (${elapsed}ms)`,
    );

    this.cache.set(system, { modules: allModules, fetchedAt: Date.now() });
    return allModules;
  }

  async refresh(force = false) {
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
      this.fetchAllModules('aws', force),
      this.fetchAllModules('azure', force),
      this.fetchAllModules('gcp', force),
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
        case 'login':
          vscode.commands.executeCommand('lace.login');
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
    const hasEngine = this.rpcClient !== null;
    const authenticated = this.authenticated;

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

    .search-row {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .search-input {
      flex: 1;
      min-width: 0;
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

    .filter-toggle {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      padding: 0;
    }

    .filter-toggle:hover {
      background: var(--vscode-toolbar-hoverBackground, #5a5d5e);
    }

    .filter-toggle.active {
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
    }

    /* ── Category chips ── */
    #chips {
      display: none;
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
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground, #bbb);
      margin-top: 4px;
      cursor: pointer;
      user-select: none;
      border-radius: 4px;
    }

    .system-header:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }

    .system-header .chevron {
      font-size: 10px;
      transition: transform 0.15s ease;
    }

    .system-header.collapsed .chevron {
      transform: rotate(-90deg);
    }

    .system-body.collapsed {
      display: none;
    }

    .module-count {
      font-weight: 400;
      color: var(--vscode-descriptionForeground, #888);
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

    .module-star,
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
    }

    .module-item:hover .module-star,
    .module-item:hover .module-add {
      display: flex;
    }

    .module-star.starred {
      display: flex;
      color: #e2b340;
    }

    .module-star:hover,
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
    <div class="search-row">
      <input
        class="search-input"
        type="text"
        id="search"
        placeholder="Search Lace Registry"
        autofocus
      />
      <button class="filter-toggle" id="filterToggle" title="Toggle filters">&#x25BD;</button>
    </div>
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
    const hasEngine = ${hasEngine};
    const authenticated = ${authenticated};

    const searchInput = document.getElementById('search');
    const chipsEl = document.getElementById('chips');
    const content = document.getElementById('content');
    const filterToggle = document.getElementById('filterToggle');

    let activeCategories = [];
    let filtersVisible = false;
    let collapsedSystems = new Set();
    let debounceTimer = null;

    filterToggle.addEventListener('click', () => {
      filtersVisible = !filtersVisible;
      render(searchInput.value);
    });

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
        : '&#x1F4E6;';
      let html = '<div class="module-item" data-idx="' + idx + '">';
      html += '  <div class="module-icon">' + iconHtml + '</div>';
      html += '  <div class="module-info">';
      html += '    <div class="module-name">' + escHtml(m.name) + '<span class="module-version">v' + escHtml(m.version) + '</span></div>';
      if (cats) html += '    <div class="module-categories">' + escHtml(cats) + '</div>';
      html += '  </div>';
      html += '  <div class="module-actions">';
      html += '    <button class="module-add" data-add-idx="' + idx + '" title="Add to canvas">+</button>';
      html += '    <button class="module-star' + (isStarred ? ' starred' : '') + '" data-star-id="' + escHtml(m.id) + '" title="' + (isStarred ? 'Unfavorite' : 'Favorite') + '">' + (isStarred ? '&#x2605;' : '&#x2606;') + '</button>';
      html += '  </div>';
      html += '</div>';
      return html;
    }

    // ── Category chips ──

    function updateToggleButton() {
      if (activeCategories.length > 0) {
        filterToggle.classList.add('active');
      } else {
        filterToggle.classList.toggle('active', filtersVisible);
      }
    }

    function renderChips(query) {
      updateToggleButton();

      if (query || allModules.length === 0 || !filtersVisible) {
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
        if (!hasEngine) {
          content.innerHTML = '<div class="empty-state">No modules available.<br/>Is the Lace engine running?</div>';
        } else if (!authenticated) {
          content.innerHTML = '<div class="empty-state">No modules available.<br/><button class="retry-btn" id="loginBtn">Login with GitHub</button></div>';
          document.getElementById('loginBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'login' });
          });
        } else {
          content.innerHTML = '<div class="empty-state">No modules available.</div>';
        }
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
        const isCollapsed = collapsedSystems.has(sys);
        const count = grouped[sys].length;
        html += '<div class="system-header' + (isCollapsed ? ' collapsed' : '') + '" data-sys="' + escHtml(sys) + '">';
        html += '<span class="chevron">&#x25BE;</span> ';
        html += escHtml(sys.toUpperCase());
        html += ' <span class="module-count">(' + count + ')</span>';
        html += '</div>';
        html += '<div class="system-body' + (isCollapsed ? ' collapsed' : '') + '" data-sys="' + escHtml(sys) + '">';
        const sorted = grouped[sys].sort((a, b) => a.name.localeCompare(b.name));
        for (const m of sorted) {
          html += renderModuleItem(m, allModules.indexOf(m));
        }
        html += '</div>';
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
      // Toggle system section collapse
      content.querySelectorAll('.system-header[data-sys]').forEach(hdr => {
        hdr.addEventListener('click', () => {
          const sys = hdr.dataset.sys;
          if (collapsedSystems.has(sys)) {
            collapsedSystems.delete(sys);
          } else {
            collapsedSystems.add(sys);
          }
          hdr.classList.toggle('collapsed');
          const body = content.querySelector('.system-body[data-sys="' + sys + '"]');
          if (body) body.classList.toggle('collapsed');
        });
      });

      // Click to show detail
      content.querySelectorAll('.module-item').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.module-star') || e.target.closest('.module-add')) return;
          const idx = parseInt(el.dataset.idx);
          vscode.postMessage({ command: 'showDetail', module: allModules[idx] });
        });
      });

      // Favorite star button
      content.querySelectorAll('.module-star').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ command: 'toggleFavorite', moduleId: btn.dataset.starId });
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
