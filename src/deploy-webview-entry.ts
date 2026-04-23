// Deploy webview bootstrap — renders the stack-picker / apply-button /
// active-run status card inside the VS Code webview and proxies user
// actions back to the host via postMessage. The matching host provider
// is src/deploy/deploy-panel-provider.ts.
//
// Shape is form-centric (select + buttons + a status card), so the UI
// is plain DOM rather than React. Keeps the bundle small and avoids
// pulling @lace-cloud/canvas through a non-canvas view.

import type { DeployPanelMessage, DeployStateSnapshot } from './deploy/messages';

type VsCodeApi = {
  postMessage(msg: DeployPanelMessage): void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

const vscode = window.acquireVsCodeApi?.();

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function mount(): void {
  const root = $('root');
  if (!root) return;
  root.innerHTML = `
    <style>
      :host, body, .deploy-root { box-sizing: border-box; }
      .deploy-root { padding: 12px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
      label { display: block; margin-top: 10px; font-size: 12px; color: var(--vscode-descriptionForeground); }
      select, button {
        width: 100%; padding: 6px 10px; margin-top: 4px; box-sizing: border-box;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px solid var(--vscode-contrastBorder, transparent);
        border-radius: 3px;
        font-family: inherit;
      }
      button.primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      .row { margin-top: 14px; }
      .error {
        background: var(--vscode-inputValidation-errorBackground);
        border: 1px solid var(--vscode-inputValidation-errorBorder);
        padding: 6px 8px;
        margin-top: 10px;
        font-size: 12px;
        display: none;
      }
      .run {
        background: var(--vscode-textBlockQuote-background);
        border: 1px solid var(--vscode-panel-border);
        padding: 10px;
        margin-top: 14px;
        display: none;
        border-radius: 3px;
        font-size: 12px;
      }
      .run strong {
        display: block;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 6px;
      }
      .run code {
        font-family: var(--vscode-editor-font-family);
        font-size: 11px;
      }
      .portal-btn { margin-top: 8px; display: none; }
    </style>
    <div class="deploy-root">
      <label for="stack-picker">Stack</label>
      <select id="stack-picker"></select>
      <div class="row">
        <button id="apply-btn" class="primary" disabled>Apply</button>
      </div>
      <div class="row">
        <button id="refresh-btn">Refresh stacks</button>
      </div>
      <div class="error" id="error"></div>
      <div class="run" id="active-run">
        <strong>Current run</strong>
        <div><code id="run-id"></code></div>
        <div>Kind: <code id="run-kind"></code></div>
        <div>Status: <code id="run-status"></code></div>
        <div><code id="run-counts"></code></div>
        <button id="portal-btn" class="portal-btn">Open in portal</button>
      </div>
    </div>
  `;

  $('stack-picker')?.addEventListener('change', (ev) => {
    const target = ev.target as HTMLSelectElement;
    vscode?.postMessage({ command: 'selectStack', stackId: target.value || null });
  });
  $('apply-btn')?.addEventListener('click', () => {
    vscode?.postMessage({ command: 'apply' });
  });
  $('refresh-btn')?.addEventListener('click', () => {
    vscode?.postMessage({ command: 'refreshStacks' });
  });
  $('portal-btn')?.addEventListener('click', () => {
    const id = $('run-id')?.textContent;
    if (id) vscode?.postMessage({ command: 'openRunInPortal', runId: id });
  });

  vscode?.postMessage({ command: 'ready' });
}

function renderSnapshot(state: DeployStateSnapshot): void {
  const picker = $('stack-picker') as HTMLSelectElement | null;
  if (!picker) return;
  picker.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '— select a stack —';
  picker.appendChild(empty);
  for (const s of state.stacks) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.slug} — ${s.name}`;
    if (s.id === state.activeStackId) opt.selected = true;
    picker.appendChild(opt);
  }
  const applyBtn = $('apply-btn') as HTMLButtonElement | null;
  if (applyBtn) applyBtn.disabled = !state.activeStackId;

  const errBox = $('error') as HTMLDivElement | null;
  if (errBox) {
    errBox.style.display = state.errorMessage ? 'block' : 'none';
    errBox.textContent = state.errorMessage ?? '';
  }

  const runBox = $('active-run') as HTMLDivElement | null;
  if (runBox && state.activeRun) {
    const r = state.activeRun;
    runBox.style.display = 'block';
    ($('run-id') as HTMLElement).textContent = r.id;
    ($('run-status') as HTMLElement).textContent = r.status;
    ($('run-kind') as HTMLElement).textContent = r.kind;
    const counts = `adds ${r.planResourceAdd ?? 0}, changes ${r.planResourceChange ?? 0}, destroys ${r.planResourceDestroy ?? 0}`;
    ($('run-counts') as HTMLElement).textContent = counts;
    const portalBtn = $('portal-btn') as HTMLButtonElement;
    portalBtn.style.display = r.status === 'awaiting_approval' ? 'inline-block' : 'none';
  } else if (runBox) {
    runBox.style.display = 'none';
  }
}

window.addEventListener('message', (ev) => {
  const msg = ev.data as { command?: string; state?: DeployStateSnapshot };
  if (msg?.command === 'snapshot' && msg.state) renderSnapshot(msg.state);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
