// ConnectWebEngine — browser-side CanvasEngine that talks to the CLI's
// Connect-Go listener over Connect-JSON (HTTP POST, fetch). Used in Storybook
// flow stories and any other browser context that can reach a running
// `lace engine` process. Extension mode continues to use PostMessageEngine.
//
// Protocol notes:
//   - Unary methods: `POST /lace.engine.LaceEngine/<MethodName>` with
//     `Content-Type: application/json`, body is the JSON-encoded request,
//     response is the JSON-encoded reply or a `{code, message}` error doc.
//   - Server streaming (Subscribe): `POST /lace.engine.LaceEngine/Subscribe`
//     with `Content-Type: application/connect+json`. Response body is a
//     sequence of length-prefixed frames. We parse them with a small
//     ReadableStream state machine.
//   - Auth: bearer token from the CLI handshake goes into the `authorization`
//     header. The same token signs every request.
//   - Session: `session_id` is captured from `SessionOpen` and injected into
//     every subsequent request. Tests can pass `sessionId` into the
//     constructor to bypass this step.

import type {
  CanvasEngine,
  EngineEvent,
  EngineEventListener,
  GenerateResult,
  GraphSummary,
  InputUpdate,
  VariableDef,
  OutputExportDef,
  OutputDefEntry,
  ProviderDef,
  ProviderConfigDef,
  LocalDef,
} from './engine';
import type {
  CanvasView,
  NodeConfig,
  EdgeConfig,
  SettingsConfig,
  RenderError,
  Diagnostic,
} from '@lace/proto';
import {
  CanvasView as CanvasViewCodec,
  SessionOpenRequest as SessionOpenRequestCodec,
  SessionOpenResponse as SessionOpenResponseCodec,
  SessionSaveRequest as SessionSaveRequestCodec,
  SessionSaveResponse as SessionSaveResponseCodec,
  SessionCloseRequest as SessionCloseRequestCodec,
  SessionCloseResponse as SessionCloseResponseCodec,
  SessionGenerateRequest as SessionGenerateRequestCodec,
  SessionGenerateResponse as SessionGenerateResponseCodec,
  PlaceModuleRequest as PlaceModuleRequestCodec,
  ConnectRequest as ConnectRequestCodec,
  AutoConnectRequest as AutoConnectRequestCodec,
  DisconnectRequest as DisconnectRequestCodec,
  UpdateInputRequest as UpdateInputRequestCodec,
  UpdateAllInputsRequest as UpdateAllInputsRequestCodec,
  RenameInstanceRequest as RenameInstanceRequestCodec,
  DeleteInstanceRequest as DeleteInstanceRequestCodec,
  CopyInstancesRequest as CopyInstancesRequestCodec,
  SyncLayoutRequest as SyncLayoutRequestCodec,
  CreateGroupRequest as CreateGroupRequestCodec,
  UpdateGroupRequest as UpdateGroupRequestCodec,
  DeleteGroupRequest as DeleteGroupRequestCodec,
  SetVariablesRequest as SetVariablesRequestCodec,
  SetExportsRequest as SetExportsRequestCodec,
  SetTerraformRequest as SetTerraformRequestCodec,
  SetProvidersRequest as SetProvidersRequestCodec,
  SetLocalsRequest as SetLocalsRequestCodec,
  SetDependsOnRequest as SetDependsOnRequestCodec,
  SetEnvironmentsRequest as SetEnvironmentsRequestCodec,
  UndoRequest as UndoRequestCodec,
  RedoRequest as RedoRequestCodec,
  NodeConfigRequest as NodeConfigRequestCodec,
  NodeConfig as NodeConfigCodec,
  EdgeConfigRequest as EdgeConfigRequestCodec,
  EdgeConfig as EdgeConfigCodec,
  QuerySettingsRequest as QuerySettingsRequestCodec,
  SettingsConfig as SettingsConfigCodec,
  QueryGraphSummaryRequest as QueryGraphSummaryRequestCodec,
  GraphSummaryResponse as GraphSummaryResponseCodec,
  QueryValidateRequest as QueryValidateRequestCodec,
  ValidateResponse as ValidateResponseCodec,
  SubscribeRequest as SubscribeRequestCodec,
  EngineEvent as EngineEventCodec,
} from './generated/service';
import type {
  CanvasView as ProtoCanvasView,
  SessionOpenRequest as ProtoSessionOpenRequest,
  SessionOpenResponse as ProtoSessionOpenResponse,
  SessionSaveResponse as ProtoSessionSaveResponse,
  SessionCloseResponse as ProtoSessionCloseResponse,
  SessionGenerateResponse as ProtoSessionGenerateResponse,
  PlaceModuleRequest as ProtoPlaceModuleRequest,
  ConnectRequest as ProtoConnectRequest,
  AutoConnectRequest as ProtoAutoConnectRequest,
  DisconnectRequest as ProtoDisconnectRequest,
  UpdateInputRequest as ProtoUpdateInputRequest,
  UpdateAllInputsRequest as ProtoUpdateAllInputsRequest,
  RenameInstanceRequest as ProtoRenameInstanceRequest,
  DeleteInstanceRequest as ProtoDeleteInstanceRequest,
  CopyInstancesRequest as ProtoCopyInstancesRequest,
  SyncLayoutRequest as ProtoSyncLayoutRequest,
  CreateGroupRequest as ProtoCreateGroupRequest,
  UpdateGroupRequest as ProtoUpdateGroupRequest,
  DeleteGroupRequest as ProtoDeleteGroupRequest,
  SetVariablesRequest as ProtoSetVariablesRequest,
  SetExportsRequest as ProtoSetExportsRequest,
  SetTerraformRequest as ProtoSetTerraformRequest,
  SetProvidersRequest as ProtoSetProvidersRequest,
  SetLocalsRequest as ProtoSetLocalsRequest,
  SetDependsOnRequest as ProtoSetDependsOnRequest,
  SetEnvironmentsRequest as ProtoSetEnvironmentsRequest,
  UndoRequest as ProtoUndoRequest,
  RedoRequest as ProtoRedoRequest,
  NodeConfigRequest as ProtoNodeConfigRequest,
  NodeConfig as ProtoNodeConfig,
  EdgeConfigRequest as ProtoEdgeConfigRequest,
  EdgeConfig as ProtoEdgeConfig,
  QuerySettingsRequest as ProtoQuerySettingsRequest,
  SettingsConfig as ProtoSettingsConfig,
  QueryGraphSummaryRequest as ProtoQueryGraphSummaryRequest,
  GraphSummaryResponse as ProtoGraphSummaryResponse,
  QueryValidateRequest as ProtoQueryValidateRequest,
  ValidateResponse as ProtoValidateResponse,
  SubscribeRequest as ProtoSubscribeRequest,
  EngineEvent as ProtoEngineEvent,
  MessageFns,
} from './generated/service';
import {
  convertCanvasView,
  convertNodeConfig,
  convertEdgeConfig,
  convertSettingsConfig,
  convertRenderError,
  convertDiagnostic,
  modeToInputMode,
} from '@lace/proto';

const SERVICE_PATH = '/lace.engine.LaceEngine';

export class ConnectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.name = 'ConnectError';
  }
}

export type ConnectWebEngineOptions = {
  baseUrl: string;
  token: string;
  sessionId?: string;
  /** Fetch impl override — used by tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
};

export class ConnectWebEngine implements CanvasEngine {
  private readonly baseUrl: string;
  private readonly token: string;
  private _sessionId: string | null;
  private readonly fetchImpl: typeof fetch;
  private subscribeAbort: AbortController | null = null;
  private readonly listeners = new Set<EngineEventListener>();

  constructor(options: ConnectWebEngineOptions) {
    // Strip trailing slash so path concatenation doesn't double up.
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this._sessionId = options.sessionId ?? null;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
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

  get sessionId(): string | null {
    return this._sessionId;
  }

  private requireSessionId(): string {
    if (!this._sessionId) throw new Error('No active session — call sessionOpen first');
    return this._sessionId;
  }

  private async unary<Req, Res>(
    method: string,
    req: Req,
    reqCodec: MessageFns<Req>,
    resCodec: MessageFns<Res>,
  ): Promise<Res> {
    const res = await this.fetchImpl(`${this.baseUrl}${SERVICE_PATH}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(reqCodec.toJSON(req)),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      // Connect error envelope: { code: "invalid_argument", message: "..." }
      let code = `http_${res.status}`;
      let message = bodyText || res.statusText;
      try {
        const parsed = JSON.parse(bodyText) as { code?: string; message?: string };
        code = parsed.code ?? code;
        message = parsed.message ?? message;
      } catch {
        /* body wasn't JSON — use text as-is */
      }
      throw new ConnectError(code, message);
    }
    const json = bodyText.length === 0 ? {} : JSON.parse(bodyText);
    return resCodec.fromJSON(json);
  }

  // ── Lifecycle ──

  async sessionOpen(filePath: string, workspaceName: string): Promise<CanvasView> {
    const req: ProtoSessionOpenRequest = {
      backed: { file_path: filePath },
      workspace_name: workspaceName,
    };
    const res = await this.unary<ProtoSessionOpenRequest, ProtoSessionOpenResponse>(
      'SessionOpen',
      req,
      SessionOpenRequestCodec,
      SessionOpenResponseCodec,
    );
    this._sessionId = res.session_id;
    if (!res.view) throw new Error('SessionOpen returned no view');
    return convertCanvasView(res.view);
  }

  async sessionSave(): Promise<{ saved: boolean }> {
    const res = await this.unary<{ session_id: string }, ProtoSessionSaveResponse>(
      'SessionSave',
      { session_id: this.requireSessionId() },
      SessionSaveRequestCodec,
      SessionSaveResponseCodec,
    );
    return { saved: res.saved };
  }

  async sessionClose(): Promise<{ status: string }> {
    const sid = this.requireSessionId();
    const res = await this.unary<{ session_id: string }, ProtoSessionCloseResponse>(
      'SessionClose',
      { session_id: sid },
      SessionCloseRequestCodec,
      SessionCloseResponseCodec,
    );
    this._sessionId = null;
    this.stopSubscribe();
    return { status: res.status };
  }

  async sessionGenerate(
    outputDir: string,
    options: { dry_run?: boolean; format?: boolean; validate?: boolean; overwrite?: boolean },
  ): Promise<GenerateResult> {
    const res = await this.unary<
      {
        session_id: string;
        output_dir: string;
        dry_run: boolean;
        format: boolean;
        validate: boolean;
        overwrite: boolean;
      },
      ProtoSessionGenerateResponse
    >(
      'SessionGenerate',
      {
        session_id: this.requireSessionId(),
        output_dir: outputDir,
        dry_run: options.dry_run ?? false,
        format: options.format ?? false,
        validate: options.validate ?? false,
        overwrite: options.overwrite ?? false,
      },
      SessionGenerateRequestCodec,
      SessionGenerateResponseCodec,
    );
    return {
      files_written: res.files_written.length > 0 ? res.files_written : undefined,
      files: Object.keys(res.files).length > 0 ? res.files : undefined,
      diagnostics: res.diagnostics.map(convertDiagnostic),
    };
  }

  // ── Actions ──

  async connect(
    source: string,
    target: string,
    sourceOutput: string,
    targetInput: string,
  ): Promise<CanvasView> {
    const req: ProtoConnectRequest = {
      session_id: this.requireSessionId(),
      connect: { source, target, source_output: sourceOutput, target_input: targetInput },
    };
    const res = await this.unary<ProtoConnectRequest, ProtoCanvasView>(
      'Connect',
      req,
      ConnectRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async autoConnect(source: string, target: string): Promise<CanvasView> {
    const req: ProtoAutoConnectRequest = {
      session_id: this.requireSessionId(),
      auto_connect: { source, target },
    };
    const res = await this.unary<ProtoAutoConnectRequest, ProtoCanvasView>(
      'AutoConnect',
      req,
      AutoConnectRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async disconnect(target: string, inputName: string): Promise<CanvasView> {
    const req: ProtoDisconnectRequest = {
      session_id: this.requireSessionId(),
      disconnect: { target, input_name: inputName },
    };
    const res = await this.unary<ProtoDisconnectRequest, ProtoCanvasView>(
      'Disconnect',
      req,
      DisconnectRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async updateInput(
    instanceId: string,
    inputName: string,
    mode: string,
    value?: unknown,
    variable?: string,
    expression?: string,
  ): Promise<CanvasView> {
    const req: ProtoUpdateInputRequest = {
      session_id: this.requireSessionId(),
      update_input: {
        instance_id: instanceId,
        input_name: inputName,
        mode: modeToInputMode(mode),
        value: value ?? undefined,
        variable: variable ?? '',
        expression: expression ?? '',
      },
    };
    const res = await this.unary<ProtoUpdateInputRequest, ProtoCanvasView>(
      'UpdateInput',
      req,
      UpdateInputRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async updateAllInputs(instanceId: string, inputs: InputUpdate[]): Promise<CanvasView> {
    const req: ProtoUpdateAllInputsRequest = {
      session_id: this.requireSessionId(),
      update_all_inputs: {
        instance_id: instanceId,
        inputs: inputs.map((i) => ({
          name: i.name,
          mode: modeToInputMode(i.mode),
          value: i.value ?? undefined,
          variable: i.variable ?? '',
          expression: i.expression ?? '',
        })),
      },
    };
    const res = await this.unary<ProtoUpdateAllInputsRequest, ProtoCanvasView>(
      'UpdateAllInputs',
      req,
      UpdateAllInputsRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async renameInstance(oldId: string, newId: string): Promise<CanvasView> {
    const req: ProtoRenameInstanceRequest = {
      session_id: this.requireSessionId(),
      rename_instance: { old_id: oldId, new_id: newId },
    };
    const res = await this.unary<ProtoRenameInstanceRequest, ProtoCanvasView>(
      'RenameInstance',
      req,
      RenameInstanceRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async deleteInstance(instanceId: string): Promise<CanvasView> {
    const req: ProtoDeleteInstanceRequest = {
      session_id: this.requireSessionId(),
      delete_instance: { instance_id: instanceId },
    };
    const res = await this.unary<ProtoDeleteInstanceRequest, ProtoCanvasView>(
      'DeleteInstance',
      req,
      DeleteInstanceRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async copyInstances(instanceIds: string[]): Promise<CanvasView> {
    const req: ProtoCopyInstancesRequest = {
      session_id: this.requireSessionId(),
      copy_instances: { instance_ids: instanceIds },
    };
    const res = await this.unary<ProtoCopyInstancesRequest, ProtoCanvasView>(
      'CopyInstances',
      req,
      CopyInstancesRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async syncLayout(positions: Record<string, { x: number; y: number }>): Promise<void> {
    const req: ProtoSyncLayoutRequest = {
      session_id: this.requireSessionId(),
      sync_layout: { positions },
    };
    await this.unary<ProtoSyncLayoutRequest, ProtoCanvasView>(
      'SyncLayout',
      req,
      SyncLayoutRequestCodec,
      CanvasViewCodec,
    );
  }

  async setVariables(variables: VariableDef[]): Promise<CanvasView> {
    const req: ProtoSetVariablesRequest = {
      session_id: this.requireSessionId(),
      set_variables: {
        variables: variables.map((v) => ({
          name: v.name,
          type: v.type,
          required: v.required,
          description: v.description ?? '',
          default_value: v.default ?? undefined,
          sensitive: false,
          validation: undefined,
        })),
      },
    };
    const res = await this.unary<ProtoSetVariablesRequest, ProtoCanvasView>(
      'SetVariables',
      req,
      SetVariablesRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async setExports(outputs: OutputExportDef[], outputDefs: OutputDefEntry[]): Promise<CanvasView> {
    const req: ProtoSetExportsRequest = {
      session_id: this.requireSessionId(),
      set_exports: {
        outputs: outputs.map((o) => ({
          name: o.name,
          source_instance: o.source_instance,
          source_output: o.source_output,
        })),
        output_defs: outputDefs.map((d) => ({
          name: d.name,
          type: d.type,
          description: d.description ?? '',
          sensitive: d.sensitive ?? false,
        })),
      },
    };
    const res = await this.unary<ProtoSetExportsRequest, ProtoCanvasView>(
      'SetExports',
      req,
      SetExportsRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async setTerraform(requiredVersion?: string, requiredProviders?: ProviderDef[]): Promise<void> {
    const req: ProtoSetTerraformRequest = {
      session_id: this.requireSessionId(),
      set_terraform: {
        required_version: requiredVersion ?? '',
        required_providers: (requiredProviders ?? []).map((p) => ({
          name: p.name,
          source: p.source,
          version: p.version,
        })),
        backend: undefined,
      },
    };
    await this.unary<ProtoSetTerraformRequest, ProtoCanvasView>(
      'SetTerraform',
      req,
      SetTerraformRequestCodec,
      CanvasViewCodec,
    );
  }

  async setProviders(providers: ProviderConfigDef[]): Promise<void> {
    const req: ProtoSetProvidersRequest = {
      session_id: this.requireSessionId(),
      set_providers: {
        providers: providers.map((p) => ({
          name: p.name,
          alias: p.alias ?? '',
          config: p.config,
        })),
      },
    };
    await this.unary<ProtoSetProvidersRequest, ProtoCanvasView>(
      'SetProviders',
      req,
      SetProvidersRequestCodec,
      CanvasViewCodec,
    );
  }

  async setLocals(locals: LocalDef[]): Promise<CanvasView> {
    const req: ProtoSetLocalsRequest = {
      session_id: this.requireSessionId(),
      set_locals: {
        locals: locals.map((l) => ({
          name: l.name,
          mode: l.mode,
          value: l.value ?? undefined,
          variable: l.variable ?? '',
          expression: l.expression ?? '',
        })),
      },
    };
    const res = await this.unary<ProtoSetLocalsRequest, ProtoCanvasView>(
      'SetLocals',
      req,
      SetLocalsRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async setDependsOn(instanceId: string, dependsOn: string[]): Promise<void> {
    const req: ProtoSetDependsOnRequest = {
      session_id: this.requireSessionId(),
      set_depends_on: { instance_id: instanceId, depends_on: dependsOn },
    };
    await this.unary<ProtoSetDependsOnRequest, ProtoCanvasView>(
      'SetDependsOn',
      req,
      SetDependsOnRequestCodec,
      CanvasViewCodec,
    );
  }

  async setEnvironments(environments: Record<string, Record<string, unknown>>): Promise<void> {
    const req: ProtoSetEnvironmentsRequest = {
      session_id: this.requireSessionId(),
      set_environments: { environments, environment_backends: {} },
    };
    await this.unary<ProtoSetEnvironmentsRequest, ProtoCanvasView>(
      'SetEnvironments',
      req,
      SetEnvironmentsRequestCodec,
      CanvasViewCodec,
    );
  }

  async undo(): Promise<CanvasView> {
    const req: ProtoUndoRequest = { session_id: this.requireSessionId() };
    const res = await this.unary<ProtoUndoRequest, ProtoCanvasView>(
      'Undo',
      req,
      UndoRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async redo(): Promise<CanvasView> {
    const req: ProtoRedoRequest = { session_id: this.requireSessionId() };
    const res = await this.unary<ProtoRedoRequest, ProtoCanvasView>(
      'Redo',
      req,
      RedoRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  // ── Groups ──

  async createGroup(label: string, nodeIds: string[]): Promise<CanvasView> {
    const req: ProtoCreateGroupRequest = {
      session_id: this.requireSessionId(),
      create_group: { label, node_ids: nodeIds },
    };
    const res = await this.unary<ProtoCreateGroupRequest, ProtoCanvasView>(
      'CreateGroup',
      req,
      CreateGroupRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async updateGroup(
    groupId: string,
    updates: { label?: string; node_ids?: string[]; collapsed?: boolean },
  ): Promise<CanvasView> {
    const req: ProtoUpdateGroupRequest = {
      session_id: this.requireSessionId(),
      update_group: {
        group_id: groupId,
        label: updates.label,
        collapsed: updates.collapsed,
        node_ids: updates.node_ids ? { node_ids: updates.node_ids } : undefined,
      },
    };
    const res = await this.unary<ProtoUpdateGroupRequest, ProtoCanvasView>(
      'UpdateGroup',
      req,
      UpdateGroupRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  async deleteGroup(groupId: string): Promise<CanvasView> {
    const req: ProtoDeleteGroupRequest = {
      session_id: this.requireSessionId(),
      delete_group: { group_id: groupId },
    };
    const res = await this.unary<ProtoDeleteGroupRequest, ProtoCanvasView>(
      'DeleteGroup',
      req,
      DeleteGroupRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  // ── Queries ──

  async queryNodeConfig(instanceId: string): Promise<NodeConfig> {
    const req: ProtoNodeConfigRequest = {
      session_id: this.requireSessionId(),
      instance_id: instanceId,
    };
    const res = await this.unary<ProtoNodeConfigRequest, ProtoNodeConfig>(
      'QueryNodeConfig',
      req,
      NodeConfigRequestCodec,
      NodeConfigCodec,
    );
    return convertNodeConfig(res);
  }

  async queryEdgeConfig(source: string, target: string): Promise<EdgeConfig> {
    const req: ProtoEdgeConfigRequest = {
      session_id: this.requireSessionId(),
      source,
      target,
    };
    const res = await this.unary<ProtoEdgeConfigRequest, ProtoEdgeConfig>(
      'QueryEdgeConfig',
      req,
      EdgeConfigRequestCodec,
      EdgeConfigCodec,
    );
    return convertEdgeConfig(res);
  }

  async querySettings(): Promise<SettingsConfig> {
    const req: ProtoQuerySettingsRequest = { session_id: this.requireSessionId() };
    const res = await this.unary<ProtoQuerySettingsRequest, ProtoSettingsConfig>(
      'QuerySettings',
      req,
      QuerySettingsRequestCodec,
      SettingsConfigCodec,
    );
    return convertSettingsConfig(res);
  }

  async queryGraphSummary(): Promise<GraphSummary> {
    const req: ProtoQueryGraphSummaryRequest = { session_id: this.requireSessionId() };
    const res = await this.unary<ProtoQueryGraphSummaryRequest, ProtoGraphSummaryResponse>(
      'QueryGraphSummary',
      req,
      QueryGraphSummaryRequestCodec,
      GraphSummaryResponseCodec,
    );
    return { text: res.text };
  }

  async queryValidate(): Promise<{ errors: RenderError[] }> {
    const req: ProtoQueryValidateRequest = { session_id: this.requireSessionId() };
    const res = await this.unary<ProtoQueryValidateRequest, ProtoValidateResponse>(
      'QueryValidate',
      req,
      QueryValidateRequestCodec,
      ValidateResponseCodec,
    );
    return { errors: res.errors.map(convertRenderError) };
  }

  // ── PlaceModule (registry) ──

  async placeModule(params: {
    name: string;
    system: string;
    version: string;
    organization?: string;
    position?: { x: number; y: number };
  }): Promise<CanvasView> {
    const req: ProtoPlaceModuleRequest = {
      session_id: this.requireSessionId(),
      name: params.name,
      system: params.system,
      version: params.version,
      organization: params.organization ?? '',
      position: params.position,
    };
    const res = await this.unary<ProtoPlaceModuleRequest, ProtoCanvasView>(
      'PlaceModule',
      req,
      PlaceModuleRequestCodec,
      CanvasViewCodec,
    );
    return convertCanvasView(res);
  }

  // ── Subscribe (server streaming) ──

  /**
   * Starts a Subscribe stream for the active session. Events are dispatched as
   * `window.postMessage` envelopes matching the VS Code bridge protocol so
   * App's existing message listener handles them uniformly. Returns an
   * unsubscribe function. Safe to call multiple times — a prior stream is
   * aborted before a new one starts.
   */
  startSubscribe(): () => void {
    this.stopSubscribe();
    const controller = new AbortController();
    this.subscribeAbort = controller;
    const sessionId = this.requireSessionId();
    void this.runSubscribe(sessionId, controller.signal).catch((err) => {
      if (controller.signal.aborted) return;
      console.error('[ConnectWebEngine] Subscribe failed:', err);
    });
    return () => {
      if (this.subscribeAbort === controller) this.stopSubscribe();
    };
  }

  stopSubscribe(): void {
    if (this.subscribeAbort) {
      this.subscribeAbort.abort();
      this.subscribeAbort = null;
    }
  }

  private async runSubscribe(sessionId: string, signal: AbortSignal): Promise<void> {
    const req: ProtoSubscribeRequest = { session_id: sessionId };
    const body = JSON.stringify(SubscribeRequestCodec.toJSON(req));
    const res = await this.fetchImpl(`${this.baseUrl}${SERVICE_PATH}/Subscribe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/connect+json',
        authorization: `Bearer ${this.token}`,
        'connect-protocol-version': '1',
      },
      body,
      signal,
    });
    if (!res.ok || !res.body) {
      throw new ConnectError(`http_${res.status}`, `Subscribe stream: ${res.statusText}`);
    }
    await readConnectStream(res.body, signal, (event) => {
      this.dispatchSubscribeEvent(event);
    });
  }

  private dispatchSubscribeEvent(event: ProtoEngineEvent): void {
    if (event.state_updated?.view) {
      this.emit({ type: 'stateUpdated', view: convertCanvasView(event.state_updated.view) });
      return;
    }
    if (event.generate_progress) {
      const phase = event.generate_progress.stage as 'generating' | 'formatting' | 'validating';
      this.emit({ type: 'generateProgress', phase });
      return;
    }
    if (event.generate_success) {
      const files =
        event.generate_success.files_written.length > 0
          ? event.generate_success.files_written
          : undefined;
      this.emit({ type: 'generateSuccess', files });
      return;
    }
    if (event.generate_error) {
      const diagnostics: Diagnostic[] = event.generate_error.diagnostics.map(convertDiagnostic);
      this.emit({
        type: 'generateError',
        message: event.generate_error.message,
        diagnostics,
      });
    }
  }
}

// ── Connect-JSON streaming frame parser ──
//
// Connect framing (connect+json):
//   Each frame: [1-byte flags][4-byte big-endian length][payload]
//   flags bit 0 (0x01) = end-of-stream marker; payload is a trailers JSON
//   flags bit 1 (0x02) = compressed (not supported here; we don't advertise)
//
// We buffer incoming bytes, emit complete frames as they arrive, and surface
// end-of-stream errors via `trailers.error` if present. Trailer JSON also
// carries `trailers` metadata; we ignore anything non-error.

async function readConnectStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: ProtoEngineEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  // Use plain Uint8Array (ArrayBufferLike) to avoid friction with stream
  // chunk typing in TS ≥ 5.7, where ReadableStream yields ArrayBufferLike.
  const chunks: Uint8Array[] = [];
  let bufferedLen = 0;
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return;
      if (!value) continue;
      chunks.push(value);
      bufferedLen += value.length;
      // Drain all complete frames currently buffered.
      while (bufferedLen >= 5) {
        const head = peekBytes(chunks, 5);
        const flags = head[0];
        const length = (head[1] << 24) | (head[2] << 16) | (head[3] << 8) | head[4];
        if (bufferedLen < 5 + length) break;
        consumeBytes(chunks, 5);
        bufferedLen -= 5;
        const payload = consumeBytes(chunks, length);
        bufferedLen -= length;
        const text = new TextDecoder().decode(payload);
        if ((flags & 0x01) === 0x01) {
          // End-of-stream frame carries trailer JSON (may include error).
          try {
            const trailers = JSON.parse(text) as { error?: { code: string; message: string } };
            if (trailers.error) {
              throw new ConnectError(trailers.error.code, trailers.error.message);
            }
          } catch (err) {
            if (err instanceof ConnectError) throw err;
            // Non-JSON trailers — ignore.
          }
          return;
        }
        const json = JSON.parse(text);
        const event = EngineEventCodec.fromJSON(json);
        onEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function peekBytes(chunks: Uint8Array[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  let written = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, n - written);
    out.set(chunk.subarray(0, take), written);
    written += take;
    if (written === n) break;
  }
  return out;
}

function consumeBytes(chunks: Uint8Array[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  let written = 0;
  while (written < n && chunks.length > 0) {
    const chunk = chunks[0];
    const take = Math.min(chunk.length, n - written);
    out.set(chunk.subarray(0, take), written);
    written += take;
    if (take === chunk.length) chunks.shift();
    else chunks[0] = chunk.subarray(take);
  }
  return out;
}
