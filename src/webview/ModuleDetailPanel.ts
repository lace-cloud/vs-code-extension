// src/webview/ModuleDetailPanel.ts
import * as vscode from 'vscode';
import type { LaceClient } from '../utilities/engine/grpc-client';
import type { RegistryModule } from '../types/protocol';

const activePanels = new Map<string, vscode.WebviewPanel>();

export async function showModuleDetail(
  mod: RegistryModule,
  rpcClient: LaceClient | null,
  onAddToCanvas: (name: string, system: string, version: string) => void,
) {
  const panelKey = `${mod.system}/${mod.name}`;

  // Reuse existing panel if open
  if (activePanels.has(panelKey)) {
    activePanels.get(panelKey)!.reveal();
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'laceModuleDetail',
    mod.name,
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  activePanels.set(panelKey, panel);
  panel.onDidDispose(() => activePanels.delete(panelKey));

  // Show loading state
  panel.webview.html = buildHtml(mod, null, null, true);

  // Fetch detailed data
  let versions: VersionEntry[] = [];
  let moduleInterface: { inputs: InterfaceField[]; outputs: InterfaceField[] } | null = null;
  let hasDeployBundle = false;
  let description = mod.description ?? '';
  let fetchError: string | null = null;

  if (rpcClient) {
    // Fetch versions (independent)
    try {
      const getResult = await rpcClient.getRegistryModule({
        name: mod.name,
        system: mod.system,
      });
      versions = getResult?.versions ?? [];

      const versionMeta = versions.find(
        (v) => v.version === mod.version || v.version === `v${mod.version}`,
      );
      if (versionMeta?.description) {
        description = versionMeta.description;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('Failed to fetch module versions:', message);
    }

    // Fetch deploy bundle (independent)
    try {
      const versionResult = await rpcClient.getRegistryVersion({
        name: mod.name,
        system: mod.system,
        version: mod.version,
      });

      hasDeployBundle = !!versionResult?.deploy_bundle;

      if (versionResult?.module_interface) {
        moduleInterface = {
          inputs: versionResult.module_interface.inputs.map((f) => ({
            name: f.name,
            type: f.type,
            required: f.required,
            description: f.description,
          })),
          outputs: versionResult.module_interface.outputs.map((f) => ({
            name: f.name,
            type: f.type,
            description: f.description,
          })),
        };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('Failed to fetch deploy bundle:', message);
      fetchError = 'Could not load deploy bundle. Some details may be unavailable.';
    }
  }

  // Render full detail
  panel.webview.html = buildHtml(mod, moduleInterface, versions, false, description, fetchError);

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage((msg) => {
    if (msg.command === 'addToCanvas' && hasDeployBundle) {
      onAddToCanvas(mod.name, mod.system, mod.version);
    }
  });
}

// ── HTML Builder ──

type InterfaceField = { name: string; type?: string; required?: boolean; description?: string };
type VersionEntry = { version: string; description?: string };

function buildHtml(
  mod: RegistryModule,
  iface: { inputs: InterfaceField[]; outputs: InterfaceField[] } | null,
  versions: VersionEntry[] | null,
  loading: boolean,
  description?: string,
  fetchError?: string | null,
): string {
  const kindBadge = 'Module';
  const kindColor = '#1f6feb';

  const inputsHtml = iface?.inputs?.length
    ? iface.inputs
        .map(
          (inp) => `
          <tr>
            <td class="prop-name">${esc(inp.name)}</td>
            <td class="prop-type">${esc(inp.type ?? 'string')}</td>
            <td class="prop-required">${inp.required !== false ? '✓' : '—'}</td>
            <td class="prop-desc">${esc(inp.description ?? '')}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No inputs defined</td></tr>';

  const outputsHtml = iface?.outputs?.length
    ? iface.outputs
        .map(
          (out) => `
          <tr>
            <td class="prop-name">${esc(out.name)}</td>
            <td class="prop-type">${esc(out.type ?? 'string')}</td>
            <td class="prop-desc" colspan="2">${esc(out.description ?? '')}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No outputs defined</td></tr>';

  const versionsHtml = versions?.length
    ? versions
        .map(
          (v) =>
            `<span class="version-tag${v.version === mod.version ? ' active' : ''}">${esc(v.version ?? 'unknown')}</span>`,
        )
        .join(' ')
    : '<span class="muted">—</span>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(mod.name)}</title>
  <style>
    :root {
      --bg: #1e1e1e;
      --surface: #252526;
      --border: #3c3c3c;
      --text: #cccccc;
      --text-muted: #888888;
      --accent: #4fc1ff;
      --green: #2ea043;
      --blue: #1f6feb;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 0;
    }

    /* ── Header ── */
    .header {
      padding: 24px 32px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: flex-start;
      gap: 20px;
    }

    .header-icon {
      width: 64px;
      height: 64px;
      border-radius: 8px;
      background: var(--surface);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      flex-shrink: 0;
    }

    .header-info { flex: 1; }

    .header-info h1 {
      font-size: 22px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 4px;
    }

    .header-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      color: #fff;
    }

    .header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .btn-primary {
      padding: 8px 20px;
      border-radius: 4px;
      background: var(--green);
      border: none;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-primary:hover { background: #3ab653; }

    /* ── Tabs ── */
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border);
      padding: 0 32px;
    }

    .tab {
      padding: 10px 16px;
      font-size: 13px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid transparent;
      cursor: pointer;
    }

    .tab.active {
      color: #fff;
      border-bottom-color: var(--accent);
    }

    /* ── Content ── */
    .content {
      padding: 24px 32px;
      max-width: 900px;
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .section { margin-bottom: 28px; }
    .section h2 {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
    }

    .section p {
      color: var(--text);
      font-size: 14px;
    }

    /* ── Table ── */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    th {
      text-align: left;
      padding: 8px 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    td {
      padding: 8px 12px;
      border: 1px solid var(--border);
      vertical-align: top;
    }

    .prop-name {
      font-family: "SF Mono", "Fira Code", monospace;
      color: var(--accent);
      white-space: nowrap;
    }

    .prop-type {
      font-family: "SF Mono", "Fira Code", monospace;
      color: #ce9178;
      font-size: 12px;
    }

    .prop-required { text-align: center; }
    .prop-desc { color: var(--text-muted); }
    .empty { color: var(--text-muted); font-style: italic; text-align: center; }

    /* ── Versions ── */
    .version-tag {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      font-size: 12px;
      font-family: "SF Mono", "Fira Code", monospace;
      color: var(--text-muted);
    }

    .version-tag.active {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(79, 193, 255, 0.1);
    }

    .muted { color: var(--text-muted); }

    /* ── Loading ── */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 60px;
      color: var(--text-muted);
      font-size: 14px;
    }

    .loading::before {
      content: '';
      width: 20px;
      height: 20px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 12px;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Example placeholder ── */
    .code-block {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 13px;
      line-height: 1.6;
      overflow-x: auto;
      white-space: pre;
      color: var(--text);
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="header-icon">📦</div>
    <div class="header-info">
      <h1>${esc(mod.name)}</h1>
      <div class="header-meta">
        <span class="badge" style="background:${kindColor}">${kindBadge}</span>
        <span>v${esc(mod.version)}</span>
        <span>·</span>
        <span>${esc(mod.system.toUpperCase())}</span>
        ${mod.categories?.length ? `<span>·</span><span>${mod.categories.map(esc).join(', ')}</span>` : ''}
      </div>
      ${description ? `<p style="color:var(--text-muted); font-size:14px;">${esc(description)}</p>` : ''}
    </div>
    <div class="header-actions">
      <button class="btn-primary" id="add-to-canvas" ${loading ? 'disabled' : ''}>Add to Canvas</button>
    </div>
  </div>

  ${fetchError ? `<div style="padding:8px 32px;background:#3b2507;color:#f0a030;font-size:13px;border-bottom:1px solid var(--border);">${esc(fetchError)}</div>` : ''}

  <!-- Tabs -->
  <div class="tabs">
    <div class="tab active" data-tab="details">Details</div>
    <div class="tab" data-tab="interface">Interface</div>
    <div class="tab" data-tab="versions">Versions</div>
    <div class="tab" data-tab="examples">Examples</div>
  </div>

  <!-- Content -->
  <div class="content">
    ${
      loading
        ? '<div class="loading">Loading module details...</div>'
        : `

    <!-- Details tab -->
    <div id="tab-details" class="tab-content active">
      <div class="section">
        <h2>About</h2>
        <p>${description ? esc(description) : 'No description available for this module. Check the Lace registry for documentation.'}</p>
      </div>
      <div class="section">
        <h2>Quick Reference</h2>
        <table>
          <tr><th style="width:140px">Property</th><th>Value</th></tr>
          <tr><td>System</td><td>${esc(mod.system.toUpperCase())}</td></tr>
          <tr><td>Kind</td><td>${esc(kindBadge)}</td></tr>
          <tr><td>Latest Version</td><td>v${esc(mod.version)}</td></tr>
          <tr><td>Inputs</td><td>${iface?.inputs?.length ?? 0} defined</td></tr>
          <tr><td>Outputs</td><td>${iface?.outputs?.length ?? 0} defined</td></tr>
        </table>
      </div>
    </div>

    <!-- Interface tab -->
    <div id="tab-interface" class="tab-content">
      <div class="section">
        <h2>Inputs</h2>
        <table>
          <tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr>
          ${inputsHtml}
        </table>
      </div>
      <div class="section">
        <h2>Outputs</h2>
        <table>
          <tr><th>Name</th><th>Type</th><th colspan="2">Description</th></tr>
          ${outputsHtml}
        </table>
      </div>
    </div>

    <!-- Versions tab -->
    <div id="tab-versions" class="tab-content">
      <div class="section">
        <h2>Available Versions</h2>
        <p>${versionsHtml}</p>
      </div>
    </div>

    <!-- Examples tab -->
    <div id="tab-examples" class="tab-content">
      <div class="section">
        <h2>Usage Example</h2>
        <p style="color: var(--text-muted); margin-bottom: 12px;">
          Drop this module onto a canvas, configure its inputs, and connect it to other modules.
        </p>
        <div class="code-block">${buildUsageExample(mod, iface)}</div>
      </div>
    </div>
    `
    }
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const target = document.getElementById('tab-' + tab.dataset.tab);
        if (target) target.classList.add('active');
      });
    });

    // Add to Canvas
    const addBtn = document.getElementById('add-to-canvas');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'addToCanvas' });
      });
    }
  </script>

</body>
</html>`;
}

function buildUsageExample(
  mod: RegistryModule,
  iface: { inputs: InterfaceField[]; outputs: InterfaceField[] } | null,
): string {
  const lines: string[] = [];
  lines.push(`# ${mod.name} (${mod.system})`);
  lines.push(`# Version: v${mod.version}`);
  lines.push('');
  if (iface?.inputs?.length) {
    lines.push('# Inputs:');
    for (const inp of iface.inputs) {
      const req = inp.required !== false ? '(required)' : '(optional)';
      lines.push(`#   ${inp.name}: ${inp.type ?? 'string'} ${req}`);
    }
    lines.push('');
  }
  if (iface?.outputs?.length) {
    lines.push('# Outputs:');
    for (const out of iface.outputs) {
      lines.push(`#   ${out.name}: ${out.type ?? 'string'}`);
    }
    lines.push('');
  }
  lines.push('# 1. Create a component: Cmd+Shift+P → "Lace: New Component"');
  lines.push(`# 2. Add this module:    Cmd+Shift+P → "Lace: Add Module" → "${mod.name}"`);
  lines.push('# 3. Click the node to configure inputs');
  lines.push('# 4. Connect to other modules by dragging edges');
  lines.push('# 5. Generate:           Cmd+Shift+P → "Lace: Generate Terraform"');
  return lines.map(esc).join('\n');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
