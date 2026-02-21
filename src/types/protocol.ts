import type { ModuleBundle } from '../webview/types/ir';
import type { WorkspaceState } from '../webview/types/workspace';

// ── GraphError (duplicated type to avoid circular dependency with validate.ts) ──
// validate.ts is the canonical source; this mirrors the shape for protocol use.

export type GraphError = {
  module_key?: string;
  instance_id?: string;
  input_name?: string;
  message: string;
};

// ── Host → Webview ──

export type HostToWebview =
  | { command: 'loadState'; state: WorkspaceState }
  | { command: 'registryList'; system: string; modules: RegistryModule[] }
  | { command: 'setRegistrySystem'; system: string }
  | { command: 'triggerSave' }
  | { command: 'triggerGenerate' }
  | { command: 'generateSuccess'; files?: string[] }
  | { command: 'generateError'; message: string; diagnostics?: Diagnostic[] }
  | { command: 'dropBundle'; requestId: number; deploy_bundle: ModuleBundle }
  | { command: 'rpcError'; requestId?: number; message: string }
  | { command: 'validationErrors'; errors: GraphError[] }
  | { command: 'engineStatus'; status: EngineStatus };

// ── Webview → Host ──

export type WebviewToHost =
  | { command: 'webviewReady' }
  | { command: 'requestRegistryModules'; system: string }
  | { command: 'saveState'; state: WorkspaceState }
  | { command: 'generateBundle'; bundle: ModuleBundle }
  | {
      command: 'fetchModuleVersion';
      requestId: number;
      name: string;
      system: string;
      version: string;
    }
  | { command: 'markDirty' };

// ── Registry types (shared) ──

export type RegistryModule = {
  id: string;
  name: string;
  system: string;
  version: string;
  kind: 'leaf' | 'composite';
  categories?: string[];
  description?: string;
};

// ── RPC diagnostic (matches Go's server.Diagnostic) ──

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  column?: number;
};

// ── Engine status ──

export type EngineStatus = 'stopped' | 'starting' | 'running' | 'error' | 'unauthenticated';
