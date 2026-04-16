// src/webview/post-message-engine.ts
//
// Implements CanvasEngine by forwarding every method call to the extension
// host via postMessage. The host routes these to the CLI via gRPC.

import type {
  CanvasEngine,
  EngineEvent,
  EngineEventListener,
  GenerateResult,
  GraphSummary,
  InputUpdate,
  LocalDef,
  OutputDefEntry,
  OutputExportDef,
  ProviderConfigDef,
  ProviderDef,
  VariableDef,
} from './engine';
import type {
  CanvasView,
  EdgeConfig,
  HostToWebview,
  NodeConfig,
  RenderError,
  SettingsConfig,
} from './types/render';

type VsCodeApi = { postMessage(msg: unknown): void };

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const CALL_TIMEOUT_MS = 30_000;

export class PostMessageEngine implements CanvasEngine {
  private pending = new Map<string, PendingCall>();
  private readonly listeners = new Set<EngineEventListener>();
  private readonly messageListener: (e: MessageEvent) => void;

  constructor(private vscode: VsCodeApi) {
    // Internalize all host→webview message handling. App subscribes via
    // onEvent(); it never needs to install its own `message` listener.
    // engineResult resolves pending RPC calls; other commands emit EngineEvents.
    this.messageListener = (e: MessageEvent) => {
      const msg = e.data as
        | HostToWebview
        | { command: 'engineResult'; requestId?: unknown; result?: unknown; error?: string }
        | null;
      if (!msg || typeof msg !== 'object' || typeof msg.command !== 'string') return;
      switch (msg.command) {
        case 'engineResult': {
          if (typeof msg.requestId !== 'string') return;
          this.resolvePending(msg.requestId, msg.result, msg.error);
          return;
        }
        case 'loadState':
          this.emit({ type: 'stateUpdated', view: msg.state, viewportIntent: msg.viewportIntent });
          return;
        case 'generateProgress':
          this.emit({ type: 'generateProgress', phase: msg.phase });
          return;
        case 'generateSuccess':
          this.emit({ type: 'generateSuccess', files: msg.files });
          return;
        case 'generateError':
          this.emit({
            type: 'generateError',
            message: msg.message,
            diagnostics: msg.diagnostics,
          });
          return;
      }
    };
    window.addEventListener('message', this.messageListener);
  }

  /** Disposes the message listener. Called when the webview unmounts. */
  dispose(): void {
    window.removeEventListener('message', this.messageListener);
    this.listeners.clear();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('PostMessageEngine disposed'));
    }
    this.pending.clear();
  }

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private resolvePending(requestId: string, result?: unknown, error?: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;

    this.pending.delete(requestId);
    clearTimeout(entry.timer);

    if (error) {
      entry.reject(new Error(error));
    } else {
      entry.resolve(result);
    }
  }

  // ── Generic RPC call ──

  private call<T>(method: string, params?: unknown): Promise<T> {
    const requestId = crypto.randomUUID();

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Engine call timeout: ${method}`));
      }, CALL_TIMEOUT_MS);

      this.pending.set(requestId, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timer,
      });

      this.vscode.postMessage({
        command: 'engineCall',
        requestId,
        method,
        params,
      });
    });
  }

  // ── Session ──

  sessionOpen(filePath: string, workspaceName: string): Promise<CanvasView> {
    return this.call('session/open', { file_path: filePath, workspace_name: workspaceName });
  }

  sessionSave(): Promise<{ saved: boolean }> {
    return this.call('session/save');
  }

  sessionClose(): Promise<{ status: string }> {
    return this.call('session/close');
  }

  sessionGenerate(
    outputDir: string,
    options: {
      dry_run?: boolean;
      format?: boolean;
      validate?: boolean;
      overwrite?: boolean;
    },
  ): Promise<GenerateResult> {
    return this.call('session/generate', { output_dir: outputDir, options });
  }

  // ── Actions ──

  connect(
    source: string,
    target: string,
    sourceOutput: string,
    targetInput: string,
  ): Promise<CanvasView> {
    return this.call('action/connect', {
      source,
      target,
      source_output: sourceOutput,
      target_input: targetInput,
    });
  }

  autoConnect(source: string, target: string): Promise<CanvasView> {
    return this.call('action/auto_connect', { source, target });
  }

  disconnect(target: string, inputName: string): Promise<CanvasView> {
    return this.call('action/disconnect', { target, input_name: inputName });
  }

  updateInput(
    instanceId: string,
    inputName: string,
    mode: string,
    value?: unknown,
    variable?: string,
    expression?: string,
  ): Promise<CanvasView> {
    return this.call('action/update_input', {
      instance_id: instanceId,
      input_name: inputName,
      mode,
      value,
      variable,
      expression,
    });
  }

  updateAllInputs(instanceId: string, inputs: InputUpdate[]): Promise<CanvasView> {
    return this.call('action/update_all_inputs', { instance_id: instanceId, inputs });
  }

  renameInstance(oldId: string, newId: string): Promise<CanvasView> {
    return this.call('action/rename_instance', { old_id: oldId, new_id: newId });
  }

  deleteInstance(instanceId: string): Promise<CanvasView> {
    return this.call('action/delete_instance', { instance_id: instanceId });
  }

  copyInstances(instanceIds: string[]): Promise<CanvasView> {
    return this.call('action/copy_instances', { instance_ids: instanceIds });
  }

  syncLayout(positions: Record<string, { x: number; y: number }>): Promise<void> {
    return this.call('action/sync_layout', { positions });
  }

  setVariables(variables: VariableDef[]): Promise<CanvasView> {
    return this.call('action/set_variables', { variables });
  }

  setExports(outputs: OutputExportDef[], outputDefs: OutputDefEntry[]): Promise<CanvasView> {
    return this.call('action/set_exports', { outputs, output_defs: outputDefs });
  }

  setTerraform(requiredVersion?: string, requiredProviders?: ProviderDef[]): Promise<void> {
    return this.call('action/set_terraform', {
      required_version: requiredVersion,
      required_providers: requiredProviders,
    });
  }

  setProviders(providers: ProviderConfigDef[]): Promise<void> {
    return this.call('action/set_providers', { providers });
  }

  setLocals(locals: LocalDef[]): Promise<CanvasView> {
    return this.call('action/set_locals', { locals });
  }

  setDependsOn(instanceId: string, dependsOn: string[]): Promise<void> {
    return this.call('action/set_depends_on', { instance_id: instanceId, depends_on: dependsOn });
  }

  setEnvironments(environments: Record<string, Record<string, unknown>>): Promise<void> {
    return this.call('action/set_environments', {
      environments,
    });
  }

  undo(): Promise<CanvasView> {
    return this.call('action/undo');
  }

  redo(): Promise<CanvasView> {
    return this.call('action/redo');
  }

  // ── Groups ──

  createGroup(label: string, nodeIds: string[]): Promise<CanvasView> {
    return this.call('action/create_group', { label, node_ids: nodeIds });
  }

  updateGroup(
    groupId: string,
    updates: { label?: string; node_ids?: string[]; collapsed?: boolean },
  ): Promise<CanvasView> {
    return this.call('action/update_group', {
      group_id: groupId,
      has_label: updates.label !== undefined,
      label: updates.label ?? '',
      has_node_ids: updates.node_ids !== undefined,
      node_ids: updates.node_ids ?? [],
      has_collapsed: updates.collapsed !== undefined,
      collapsed: updates.collapsed ?? false,
    });
  }

  deleteGroup(groupId: string): Promise<CanvasView> {
    return this.call('action/delete_group', { group_id: groupId });
  }

  // ── Queries ──

  queryNodeConfig(instanceId: string): Promise<NodeConfig> {
    return this.call('query/node_config', { instance_id: instanceId });
  }

  queryEdgeConfig(source: string, target: string): Promise<EdgeConfig> {
    return this.call('query/edge_config', { source, target });
  }

  querySettings(): Promise<SettingsConfig> {
    return this.call('query/settings');
  }

  queryGraphSummary(): Promise<GraphSummary> {
    return this.call('query/graph_summary');
  }

  queryValidate(): Promise<{ errors: RenderError[] }> {
    return this.call('query/validate');
  }
}
