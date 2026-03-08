import type { Bundle } from '../webview/types/ir';
import type { WorkspaceState } from '../webview/types/workspace';
import type { GraphError } from '../webview/utils/validate';

// ── Host → Webview ──

export type HostToWebview =
  | { command: 'loadState'; state: WorkspaceState }
  | { command: 'saveConfirmed' }
  | { command: 'triggerSave' }
  | { command: 'triggerGenerate' }
  | { command: 'generateSuccess'; files?: string[] }
  | { command: 'generateError'; message: string; diagnostics?: Diagnostic[] }
  | { command: 'dropBundle'; deploy_bundle: Bundle; icon_url?: string }
  | { command: 'validationErrors'; errors: GraphError[] }
  | { command: 'triggerVariables' }
  | { command: 'triggerOutputs' }
  | { command: 'triggerTerraformConfig' }
  | { command: 'triggerProviders' }
  | { command: 'triggerLocals' }
  | { command: 'triggerEnvironments' }
  | {
      command: 'refreshModuleDefs';
      updated_modules: Record<string, import('../webview/types/ir').Module>;
      icon_updates?: Record<string, string>;
    }
  | { command: 'getGraphState'; requestId: string }
  | {
      command: 'dispatchAction';
      requestId: string;
      action: import('../webview/state/reducer').WorkspaceAction;
    };

// ── Webview → Host ──

export type WebviewToHost =
  | { command: 'webviewReady' }
  | { command: 'saveState'; state: WorkspaceState }
  | { command: 'generateBundle'; bundle: Bundle }
  | { command: 'markDirty'; state: WorkspaceState }
  | { command: 'markClean' }
  | {
      command: 'refreshModules';
      module_keys: Record<string, { id: string; version: string }>;
    }
  | { command: 'graphStateResponse'; requestId: string; state: WorkspaceState }
  | { command: 'dispatchActionResponse'; requestId: string; success: boolean; error?: string };

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
