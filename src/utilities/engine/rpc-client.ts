import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';
import type {
  CanvasView,
  NodeConfig,
  EdgeConfig,
  SettingsConfig,
  RenderError,
} from '../../webview/types/render';
import type { Diagnostic, RegistryModule } from '../../types/protocol';

interface RPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface RPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/** Minimal log sink interface (matches vscode.OutputChannel.appendLine). */
type LogSink = { appendLine(line: string): void } | null;

// ── RPC result envelopes ──

type RegistryListResult = {
  modules: RegistryModule[];
  pagination?: { page: number; limit: number; total: number };
};

type RegistryVersionResult = {
  name: string;
  system: string;
  version: string;
  deploy_bundle?: unknown; // opaque — the CLI handles this internally now
};

type RegistryModuleResult = {
  name: string;
  system: string;
  versions: Array<{ version: string; description?: string }>;
};

// ── Auth result envelopes ──

export type AuthStatusResult = {
  authenticated: boolean;
  user?: { id: string; email: string; name: string };
  base_url?: string;
};

export type AuthLoginResult = {
  success: boolean;
  user?: { id: string; email: string; name: string };
  error?: string;
};

export class JSONRPCClient extends EventEmitter {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private rl: readline.Interface | null = null;

  constructor(
    private process: ChildProcess,
    private timeoutMs = 30_000,
    private log: LogSink = null,
  ) {
    super();
    this.setupReader();
  }

  private setupReader(): void {
    if (!this.process.stdout) {
      return;
    }

    this.rl = readline.createInterface({
      input: this.process.stdout,
    });

    this.rl.on('line', (line) => {
      line = line.trim();

      if (!line.startsWith('{')) {
        if (line) this.log?.appendLine(`[rpc] non-JSON stdout: ${line}`);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        this.log?.appendLine(`[rpc] malformed JSON: ${line}`);
        return;
      }

      try {
        const msg = parsed as RPCResponse;

        // Validate this is actually a JSON-RPC response we're expecting
        if (msg.jsonrpc !== '2.0' || typeof msg.id !== 'number') {
          this.log?.appendLine(`[rpc] non-RPC JSON: ${line}`);
          return;
        }

        const pending = this.pending.get(msg.id);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeout);
        this.pending.delete(msg.id);

        if (msg.error) {
          pending.reject(
            new Error(
              `${msg.error.message}${msg.error.data ? `: ${JSON.stringify(msg.error.data)}` : ''}`,
            ),
          );
        } else {
          pending.resolve(msg.result);
        }
      } catch (err) {
        this.emit('error', err);
      }
    });
  }

  call<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const request: RPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timeout,
      });

      this.process.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  initialize(clientVersion: string) {
    return this.call<{ serverVersion: string; capabilities?: string[] }>('initialize', {
      clientVersion,
    });
  }

  shutdown() {
    return this.call<{ status: string }>('shutdown');
  }

  // ── Auth methods ──

  authStatus() {
    return this.call<AuthStatusResult>('auth/status');
  }

  authLogin(params: { token: string }) {
    return this.call<AuthLoginResult>('auth/login', params);
  }

  authLogout() {
    return this.call<{ success: boolean }>('auth/logout');
  }

  // ── Registry methods ──

  listRegistryModules(params?: {
    system?: string;
    search?: string;
    category?: string;
    kind?: string;
    page?: number;
    limit?: number;
    organization?: string;
  }) {
    return this.call<RegistryListResult>('registry/list', params);
  }

  getRegistryVersion(params: {
    name: string;
    system: string;
    version: string;
    organization?: string;
  }) {
    return this.call<RegistryVersionResult>('registry/version', params);
  }

  getRegistryModule(params: { name: string; system: string; organization?: string }) {
    return this.call<RegistryModuleResult>('registry/get', params);
  }

  // ── Session methods ──

  sessionOpen(params: { file_path: string; workspace_name: string }) {
    return this.call<CanvasView>('session/open', params);
  }

  sessionSave() {
    return this.call<{ saved: boolean }>('session/save');
  }

  sessionClose() {
    return this.call<{ status: string }>('session/close');
  }

  sessionGenerate(params: {
    output_dir: string;
    options?: { dry_run?: boolean; format?: boolean; validate?: boolean; overwrite?: boolean };
  }) {
    return this.call<{
      files_written?: string[];
      files?: Record<string, string>;
      diagnostics: Diagnostic[];
    }>('session/generate', params);
  }

  // ── Action methods ──

  actionDropModule(params: { registry_key: string; position?: { x: number; y: number } }) {
    return this.call<CanvasView>('action/drop_module', params);
  }

  actionConnect(params: {
    source: string;
    target: string;
    source_output: string;
    target_input: string;
  }) {
    return this.call<CanvasView>('action/connect', params);
  }

  actionAutoConnect(params: { source: string; target: string }) {
    return this.call<CanvasView>('action/auto_connect', params);
  }

  actionDisconnect(params: { target: string; input_name: string }) {
    return this.call<CanvasView>('action/disconnect', params);
  }

  actionUpdateInput(params: {
    instance_id: string;
    input_name: string;
    mode: string;
    value?: unknown;
    variable?: string;
    expression?: string;
  }) {
    return this.call<CanvasView>('action/update_input', params);
  }

  actionUpdateAllInputs(params: {
    instance_id: string;
    inputs: Array<{
      name: string;
      mode: string;
      value?: unknown;
      variable?: string;
      expression?: string;
    }>;
  }) {
    return this.call<CanvasView>('action/update_all_inputs', params);
  }

  actionRenameInstance(params: { old_id: string; new_id: string }) {
    return this.call<CanvasView>('action/rename_instance', params);
  }

  actionDeleteInstance(params: { instance_id: string }) {
    return this.call<CanvasView>('action/delete_instance', params);
  }

  actionSyncLayout(params: { positions: Record<string, { x: number; y: number }> }) {
    return this.call<Record<string, never>>('action/sync_layout', params);
  }

  actionSetVariables(params: {
    variables: Array<{
      name: string;
      type: string;
      required: boolean;
      description?: string;
      default?: unknown;
    }>;
  }) {
    return this.call<CanvasView>('action/set_variables', params);
  }

  actionSetExports(params: {
    outputs: Array<{ name: string; source_instance: string; source_output: string }>;
    output_defs: Array<{ name: string; type: string; description?: string; sensitive?: boolean }>;
  }) {
    return this.call<CanvasView>('action/set_exports', params);
  }

  actionSetTerraform(params: {
    required_version?: string;
    required_providers?: Array<{ name: string; source: string; version: string }>;
    backend?: { type: string; config: Record<string, unknown> };
  }) {
    return this.call<Record<string, never>>('action/set_terraform', params);
  }

  actionSetProviders(params: {
    providers: Array<{ name: string; alias?: string; config: Record<string, unknown> }>;
  }) {
    return this.call<Record<string, never>>('action/set_providers', params);
  }

  actionSetLocals(params: {
    locals: Array<{
      name: string;
      mode: string;
      value?: unknown;
      variable?: string;
      expression?: string;
    }>;
  }) {
    return this.call<CanvasView>('action/set_locals', params);
  }

  actionSetDependsOn(params: { instance_id: string; depends_on: string[] }) {
    return this.call<Record<string, never>>('action/set_depends_on', params);
  }

  actionSetEnvironments(params: {
    environments: Record<string, Record<string, unknown>>;
    environment_backends: Record<string, { type: string; config: Record<string, unknown> }>;
  }) {
    return this.call<Record<string, never>>('action/set_environments', params);
  }

  actionUndo() {
    return this.call<CanvasView>('action/undo');
  }

  actionRedo() {
    return this.call<CanvasView>('action/redo');
  }

  // ── Query methods ──

  queryNodeConfig(params: { instance_id: string }) {
    return this.call<NodeConfig>('query/node_config', params);
  }

  queryEdgeConfig(params: { source: string; target: string }) {
    return this.call<EdgeConfig>('query/edge_config', params);
  }

  querySettings() {
    return this.call<SettingsConfig>('query/settings');
  }

  queryGraphSummary() {
    return this.call<{ text: string }>('query/graph_summary');
  }

  queryValidate() {
    return this.call<{ errors: RenderError[] }>('query/validate');
  }

  dispose(): void {
    this.rl?.close();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disposed'));
    }
    this.pending.clear();
  }
}
