import type { CanvasView } from '../webview/types/render';

// ── Host → Webview ──

export type HostToWebview =
  | { command: 'loadState'; state: CanvasView }
  | { command: 'generateSuccess'; files?: string[] }
  | { command: 'generateError'; message: string; diagnostics?: Diagnostic[] }
  | { command: 'engineResult'; requestId: string; result?: unknown; error?: string };

// ── Webview → Host ──

export type WebviewToHost =
  | { command: 'webviewReady' }
  | { command: 'engineCall'; requestId: string; method: string; params?: unknown }
  | { command: 'markDirty' }
  | { command: 'markClean' };

// ── RPC diagnostic (matches Go's server.Diagnostic) ──

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  column?: number;
};

// ── Registry module (shared across sidebar, detail panel, extension) ──

export type RegistryModule = {
  id: string;
  name: string;
  system: string;
  version: string;
  categories?: string[];
  description?: string;
  icon_url?: string;
};
