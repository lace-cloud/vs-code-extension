import type { ModuleBundle } from '../webview/types/ir';
import type { WorkspaceState } from '../webview/types/workspace';
import type { GraphError } from '../webview/utils/validate';

// ── Host → Webview ──

export type HostToWebview =
  | { command: 'loadState'; state: WorkspaceState }
  | { command: 'triggerSave' }
  | { command: 'triggerGenerate' }
  | { command: 'generateSuccess'; files?: string[] }
  | { command: 'generateError'; message: string; diagnostics?: Diagnostic[] }
  | { command: 'dropBundle'; deploy_bundle: ModuleBundle }
  | { command: 'validationErrors'; errors: GraphError[] };

// ── Webview → Host ──

export type WebviewToHost =
  | { command: 'webviewReady' }
  | { command: 'saveState'; state: WorkspaceState }
  | { command: 'generateBundle'; bundle: ModuleBundle }
  | { command: 'markDirty' };

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
  kind: 'leaf' | 'composite';
  categories?: string[];
  description?: string;
};
