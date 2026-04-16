import * as grpc from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import { LaceEngineClient as GrpcClient } from './generated/service';
import type {
  CanvasView as ProtoCanvasView,
  NodeConfig as ProtoNodeConfig,
  EdgeConfig as ProtoEdgeConfig,
  SettingsConfig as ProtoSettingsConfig,
  SessionOpenResponse,
  SessionGenerateResponse,
  InitializeResponse,
  ShutdownResponse,
  RegistryListResponse,
  RegistryGetVersionsResponse,
  InspectModuleResponse,
  SessionSaveResponse,
  SessionCloseResponse,
  ValidateResponse,
  GraphSummaryResponse,
  PlaceModuleRequest,
  ConnectRequest,
  AutoConnectRequest,
  DisconnectRequest,
  UpdateInputRequest,
  UpdateAllInputsRequest,
  RenameInstanceRequest,
  DeleteInstanceRequest,
  CopyInstancesRequest,
  SyncLayoutRequest,
  CreateGroupRequest,
  UpdateGroupRequest,
  DeleteGroupRequest,
  SetVariablesRequest,
  SetExportsRequest,
  SetTerraformRequest,
  SetProvidersRequest,
  SetLocalsRequest,
  SetDependsOnRequest,
  SetEnvironmentsRequest,
  UndoRequest,
  RedoRequest,
  NodeConfigRequest,
  EdgeConfigRequest,
  QuerySettingsRequest,
  QueryGraphSummaryRequest,
  QueryValidateRequest,
  InputEntry,
  OutputExportEntry,
  ProviderReqView,
  ProviderView,
  LocalEntry,
  InputDef,
  OutputDef,
} from './generated/service';
import {
  convertCanvasView,
  convertNodeConfig,
  convertEdgeConfig,
  convertSettingsConfig,
  convertDiagnostic,
  convertRenderError,
  modeToInputMode,
} from '@lace/proto';
import type {
  CanvasView,
  NodeConfig,
  EdgeConfig,
  SettingsConfig,
  RenderError,
  Diagnostic,
} from '@lace/proto';
import type { RegistryModule } from './types';

// ── LaceTransport ──

export class LaceTransport {
  private inner: GrpcClient;
  private token: string;
  private _sessionId: string | null = null;

  constructor(port: number, token: string) {
    this.token = token;
    this.inner = new GrpcClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  private makeMetadata(): grpc.Metadata {
    const meta = new grpc.Metadata();
    meta.add('authorization', `Bearer ${this.token}`);
    return meta;
  }

  private requireSessionId(): string {
    if (!this._sessionId) throw new Error('No active session — call sessionOpen first');
    return this._sessionId;
  }

  private unary<Req, Res>(
    method: (
      request: Req,
      metadata: grpc.Metadata,
      callback: (error: ServiceError | null, response: Res) => void,
    ) => void,
    request: Req,
  ): Promise<Res> {
    const meta = this.makeMetadata();
    return new Promise<Res>((resolve, reject) => {
      method.call(this.inner, request, meta, (error: ServiceError | null, response: Res) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
  }

  // ── Lifecycle ──

  async initialize(
    clientVersion: string,
  ): Promise<{ serverVersion: string; capabilities?: string[] }> {
    const res = await this.unary<
      { client_version: string; protocol_version: string },
      InitializeResponse
    >(this.inner.initialize, { client_version: clientVersion, protocol_version: '1.0' });
    return {
      serverVersion: res.server_version,
      capabilities: res.capabilities.length > 0 ? res.capabilities : undefined,
    };
  }

  async shutdown(): Promise<void> {
    await this.unary<Record<string, never>, ShutdownResponse>(this.inner.shutdown, {});
  }

  // ── Registry ──

  async listRegistryModules(params?: {
    system?: string;
    search?: string;
    category?: string;
    kind?: string;
    page?: number;
    limit?: number;
    organization?: string;
  }): Promise<{
    modules: RegistryModule[];
    pagination?: { page: number; limit: number; total: number };
  }> {
    const res = await this.unary<
      {
        system: string;
        search: string;
        category: string;
        kind: string;
        page: number;
        limit: number;
        organization: string;
      },
      RegistryListResponse
    >(this.inner.registryList, {
      system: params?.system ?? '',
      search: params?.search ?? '',
      category: params?.category ?? '',
      kind: params?.kind ?? '',
      page: params?.page ?? 0,
      limit: params?.limit ?? 0,
      organization: params?.organization ?? '',
    });
    return {
      modules: res.modules.map((m) => ({
        id: m.id,
        name: m.name,
        system: m.system,
        version: m.version,
        description: m.description || undefined,
        icon_url: m.icon_url || undefined,
        categories: m.categories.length > 0 ? m.categories : undefined,
      })),
      pagination:
        res.total > 0 ? { page: res.page, limit: res.limit, total: res.total } : undefined,
    };
  }

  async registryGetVersions(params: {
    name: string;
    system: string;
    organization?: string;
  }): Promise<{
    name: string;
    system: string;
    versions: Array<{ version: string; description?: string }>;
  }> {
    const res = await this.unary<
      { name: string; system: string; organization: string },
      RegistryGetVersionsResponse
    >(this.inner.registryGetVersions, {
      name: params.name,
      system: params.system,
      organization: params.organization ?? '',
    });
    return {
      name: res.name,
      system: res.system,
      versions: res.versions.map((v) => ({
        version: v.version,
        description: v.description || undefined,
      })),
    };
  }

  async inspectModule(params: {
    name: string;
    system: string;
    version: string;
    organization?: string;
  }): Promise<{
    name: string;
    system: string;
    version: string;
    module_interface?: {
      inputs: Array<{
        name: string;
        type: string;
        required: boolean;
        description: string;
        default_value?: unknown;
        sensitive: boolean;
      }>;
      outputs: Array<{
        name: string;
        type: string;
        required: boolean;
        description: string;
        default_value?: unknown;
        sensitive: boolean;
      }>;
    };
  }> {
    const res = await this.unary<
      { name: string; system: string; version: string; organization: string },
      InspectModuleResponse
    >(this.inner.inspectModule, {
      name: params.name,
      system: params.system,
      version: params.version,
      organization: params.organization ?? '',
    });
    return {
      name: res.name,
      system: res.system,
      version: res.version,
      module_interface: res.module_interface
        ? {
            inputs: res.module_interface.inputs.map((f) => ({
              name: f.name,
              type: f.type,
              required: f.required,
              description: f.description,
              default_value: f.default_value ?? undefined,
              sensitive: f.sensitive,
            })),
            outputs: res.module_interface.outputs.map((f) => ({
              name: f.name,
              type: f.type,
              required: f.required,
              description: f.description,
              default_value: f.default_value ?? undefined,
              sensitive: f.sensitive,
            })),
          }
        : undefined,
    };
  }

  // ── Session ──

  async sessionOpen(params: {
    file_path: string;
    workspace_name: string;
  }): Promise<{ session_id: string; view: CanvasView }> {
    const res = await this.unary<
      { backed: { file_path: string }; workspace_name: string },
      SessionOpenResponse
    >(this.inner.sessionOpen, {
      backed: { file_path: params.file_path },
      workspace_name: params.workspace_name,
    });
    this._sessionId = res.session_id;
    return { session_id: res.session_id, view: convertCanvasView(res.view!) };
  }

  async sessionSave(): Promise<{ saved: boolean }> {
    const res = await this.unary<{ session_id: string }, SessionSaveResponse>(
      this.inner.sessionSave,
      { session_id: this.requireSessionId() },
    );
    return { saved: res.saved };
  }

  async sessionClose(): Promise<{ status: string }> {
    const sid = this.requireSessionId();
    const res = await this.unary<{ session_id: string }, SessionCloseResponse>(
      this.inner.sessionClose,
      { session_id: sid },
    );
    this._sessionId = null;
    return { status: res.status };
  }

  async sessionGenerate(params: {
    output_dir: string;
    options?: { dry_run?: boolean; format?: boolean; validate?: boolean; overwrite?: boolean };
  }): Promise<{
    files_written?: string[];
    files?: Record<string, string>;
    diagnostics: Diagnostic[];
  }> {
    const res = await this.unary<
      {
        session_id: string;
        output_dir: string;
        dry_run: boolean;
        format: boolean;
        validate: boolean;
        overwrite: boolean;
      },
      SessionGenerateResponse
    >(this.inner.sessionGenerate, {
      session_id: this.requireSessionId(),
      output_dir: params.output_dir,
      dry_run: params.options?.dry_run ?? false,
      format: params.options?.format ?? false,
      validate: params.options?.validate ?? false,
      overwrite: params.options?.overwrite ?? false,
    });
    return {
      files_written: res.files_written.length > 0 ? res.files_written : undefined,
      files: Object.keys(res.files).length > 0 ? res.files : undefined,
      diagnostics: res.diagnostics.map(convertDiagnostic),
    };
  }

  // ── PlaceModule (replaces getRegistryVersion + dropBundle) ──

  async placeModule(params: {
    name: string;
    system: string;
    version: string;
    organization?: string;
    position?: { x: number; y: number };
  }): Promise<CanvasView> {
    const res = await this.unary<PlaceModuleRequest, ProtoCanvasView>(this.inner.placeModule, {
      session_id: this.requireSessionId(),
      name: params.name,
      system: params.system,
      version: params.version,
      organization: params.organization ?? '',
      position: params.position,
    });
    return convertCanvasView(res);
  }

  // ── Mutations ──

  async connect(params: {
    source: string;
    target: string;
    source_output: string;
    target_input: string;
  }): Promise<CanvasView> {
    const res = await this.unary<ConnectRequest, ProtoCanvasView>(this.inner.connect, {
      session_id: this.requireSessionId(),
      connect: params,
    });
    return convertCanvasView(res);
  }

  async autoConnect(params: { source: string; target: string }): Promise<CanvasView> {
    const res = await this.unary<AutoConnectRequest, ProtoCanvasView>(this.inner.autoConnect, {
      session_id: this.requireSessionId(),
      auto_connect: params,
    });
    return convertCanvasView(res);
  }

  async disconnect(params: { target: string; input_name: string }): Promise<CanvasView> {
    const res = await this.unary<DisconnectRequest, ProtoCanvasView>(this.inner.disconnect, {
      session_id: this.requireSessionId(),
      disconnect: params,
    });
    return convertCanvasView(res);
  }

  async updateInput(params: {
    instance_id: string;
    input_name: string;
    mode: string;
    value?: unknown;
    variable?: string;
    expression?: string;
  }): Promise<CanvasView> {
    const res = await this.unary<UpdateInputRequest, ProtoCanvasView>(this.inner.updateInput, {
      session_id: this.requireSessionId(),
      update_input: {
        instance_id: params.instance_id,
        input_name: params.input_name,
        mode: modeToInputMode(params.mode),
        value: params.value ?? undefined,
        variable: params.variable ?? '',
        expression: params.expression ?? '',
      },
    });
    return convertCanvasView(res);
  }

  async updateAllInputs(params: {
    instance_id: string;
    inputs: Array<{
      name: string;
      mode: string;
      value?: unknown;
      variable?: string;
      expression?: string;
    }>;
  }): Promise<CanvasView> {
    const inputs: InputEntry[] = params.inputs.map((inp) => ({
      name: inp.name,
      mode: modeToInputMode(inp.mode),
      value: inp.value ?? undefined,
      variable: inp.variable ?? '',
      expression: inp.expression ?? '',
    }));
    const res = await this.unary<UpdateAllInputsRequest, ProtoCanvasView>(
      this.inner.updateAllInputs,
      {
        session_id: this.requireSessionId(),
        update_all_inputs: { instance_id: params.instance_id, inputs },
      },
    );
    return convertCanvasView(res);
  }

  async renameInstance(params: { old_id: string; new_id: string }): Promise<CanvasView> {
    const res = await this.unary<RenameInstanceRequest, ProtoCanvasView>(
      this.inner.renameInstance,
      { session_id: this.requireSessionId(), rename_instance: params },
    );
    return convertCanvasView(res);
  }

  async deleteInstance(params: { instance_id: string }): Promise<CanvasView> {
    const res = await this.unary<DeleteInstanceRequest, ProtoCanvasView>(
      this.inner.deleteInstance,
      { session_id: this.requireSessionId(), delete_instance: params },
    );
    return convertCanvasView(res);
  }

  async copyInstances(params: { instance_ids: string[] }): Promise<CanvasView> {
    const res = await this.unary<CopyInstancesRequest, ProtoCanvasView>(this.inner.copyInstances, {
      session_id: this.requireSessionId(),
      copy_instances: params,
    });
    return convertCanvasView(res);
  }

  async syncLayout(params: { positions: Record<string, { x: number; y: number }> }): Promise<void> {
    await this.unary<SyncLayoutRequest, ProtoCanvasView>(this.inner.syncLayout, {
      session_id: this.requireSessionId(),
      sync_layout: params,
    });
  }

  async createGroup(params: { label: string; node_ids: string[] }): Promise<CanvasView> {
    const res = await this.unary<CreateGroupRequest, ProtoCanvasView>(this.inner.createGroup, {
      session_id: this.requireSessionId(),
      create_group: params,
    });
    return convertCanvasView(res);
  }

  async updateGroup(params: {
    group_id: string;
    label?: string;
    node_ids?: string[];
    collapsed?: boolean;
  }): Promise<CanvasView> {
    const res = await this.unary<UpdateGroupRequest, ProtoCanvasView>(this.inner.updateGroup, {
      session_id: this.requireSessionId(),
      update_group: {
        group_id: params.group_id,
        label: params.label,
        collapsed: params.collapsed,
        node_ids: params.node_ids ? { node_ids: params.node_ids } : undefined,
      },
    });
    return convertCanvasView(res);
  }

  async deleteGroup(params: { group_id: string }): Promise<CanvasView> {
    const res = await this.unary<DeleteGroupRequest, ProtoCanvasView>(this.inner.deleteGroup, {
      session_id: this.requireSessionId(),
      delete_group: params,
    });
    return convertCanvasView(res);
  }

  async setVariables(params: {
    variables: Array<{
      name: string;
      type: string;
      required: boolean;
      description?: string;
      default?: unknown;
    }>;
  }): Promise<CanvasView> {
    const variables: InputDef[] = params.variables.map((v) => ({
      name: v.name,
      type: v.type,
      required: v.required,
      description: v.description ?? '',
      default_value: v.default ?? undefined,
      sensitive: false,
      validation: undefined,
    }));
    const res = await this.unary<SetVariablesRequest, ProtoCanvasView>(this.inner.setVariables, {
      session_id: this.requireSessionId(),
      set_variables: { variables },
    });
    return convertCanvasView(res);
  }

  async setExports(params: {
    outputs: Array<{ name: string; source_instance: string; source_output: string }>;
    output_defs: Array<{ name: string; type: string; description?: string; sensitive?: boolean }>;
  }): Promise<CanvasView> {
    const outputs: OutputExportEntry[] = params.outputs.map((o) => ({
      name: o.name,
      source_instance: o.source_instance,
      source_output: o.source_output,
    }));
    const output_defs: OutputDef[] = params.output_defs.map((d) => ({
      name: d.name,
      type: d.type,
      description: d.description ?? '',
      sensitive: d.sensitive ?? false,
    }));
    const res = await this.unary<SetExportsRequest, ProtoCanvasView>(this.inner.setExports, {
      session_id: this.requireSessionId(),
      set_exports: { outputs, output_defs },
    });
    return convertCanvasView(res);
  }

  async setTerraform(params: {
    required_version?: string;
    required_providers?: Array<{ name: string; source: string; version: string }>;
  }): Promise<void> {
    const required_providers: ProviderReqView[] = (params.required_providers ?? []).map((p) => ({
      name: p.name,
      source: p.source,
      version: p.version,
    }));
    await this.unary<SetTerraformRequest, ProtoCanvasView>(this.inner.setTerraform, {
      session_id: this.requireSessionId(),
      set_terraform: {
        required_version: params.required_version ?? '',
        required_providers,
        backend: undefined,
      },
    });
  }

  async setProviders(params: {
    providers: Array<{ name: string; alias?: string; config: Record<string, unknown> }>;
  }): Promise<void> {
    const providers: ProviderView[] = params.providers.map((p) => ({
      name: p.name,
      alias: p.alias ?? '',
      config: p.config,
    }));
    await this.unary<SetProvidersRequest, ProtoCanvasView>(this.inner.setProviders, {
      session_id: this.requireSessionId(),
      set_providers: { providers },
    });
  }

  async setLocals(params: {
    locals: Array<{
      name: string;
      mode: string;
      value?: unknown;
      variable?: string;
      expression?: string;
    }>;
  }): Promise<CanvasView> {
    const locals: LocalEntry[] = params.locals.map((l) => ({
      name: l.name,
      mode: l.mode,
      value: l.value ?? undefined,
      variable: l.variable ?? '',
      expression: l.expression ?? '',
    }));
    const res = await this.unary<SetLocalsRequest, ProtoCanvasView>(this.inner.setLocals, {
      session_id: this.requireSessionId(),
      set_locals: { locals },
    });
    return convertCanvasView(res);
  }

  async setDependsOn(params: { instance_id: string; depends_on: string[] }): Promise<void> {
    await this.unary<SetDependsOnRequest, ProtoCanvasView>(this.inner.setDependsOn, {
      session_id: this.requireSessionId(),
      set_depends_on: params,
    });
  }

  async setEnvironments(params: {
    environments: Record<string, Record<string, unknown>>;
  }): Promise<void> {
    await this.unary<SetEnvironmentsRequest, ProtoCanvasView>(this.inner.setEnvironments, {
      session_id: this.requireSessionId(),
      set_environments: { environments: params.environments, environment_backends: {} },
    });
  }

  async undo(): Promise<CanvasView> {
    const res = await this.unary<UndoRequest, ProtoCanvasView>(this.inner.undo, {
      session_id: this.requireSessionId(),
    });
    return convertCanvasView(res);
  }

  async redo(): Promise<CanvasView> {
    const res = await this.unary<RedoRequest, ProtoCanvasView>(this.inner.redo, {
      session_id: this.requireSessionId(),
    });
    return convertCanvasView(res);
  }

  // ── Queries ──

  async queryNodeConfig(params: { instance_id: string }): Promise<NodeConfig> {
    const res = await this.unary<NodeConfigRequest, ProtoNodeConfig>(this.inner.queryNodeConfig, {
      session_id: this.requireSessionId(),
      instance_id: params.instance_id,
    });
    return convertNodeConfig(res);
  }

  async queryEdgeConfig(params: { source: string; target: string }): Promise<EdgeConfig> {
    const res = await this.unary<EdgeConfigRequest, ProtoEdgeConfig>(this.inner.queryEdgeConfig, {
      session_id: this.requireSessionId(),
      source: params.source,
      target: params.target,
    });
    return convertEdgeConfig(res);
  }

  async querySettings(): Promise<SettingsConfig> {
    const res = await this.unary<QuerySettingsRequest, ProtoSettingsConfig>(
      this.inner.querySettings,
      { session_id: this.requireSessionId() },
    );
    return convertSettingsConfig(res);
  }

  async queryGraphSummary(): Promise<{ text: string }> {
    const res = await this.unary<QueryGraphSummaryRequest, GraphSummaryResponse>(
      this.inner.queryGraphSummary,
      { session_id: this.requireSessionId() },
    );
    return { text: res.text };
  }

  async queryValidate(): Promise<{ errors: RenderError[] }> {
    const res = await this.unary<QueryValidateRequest, ValidateResponse>(this.inner.queryValidate, {
      session_id: this.requireSessionId(),
    });
    return { errors: res.errors.map(convertRenderError) };
  }

  // ── Subscribe stream ──

  subscribeStream(sessionId: string) {
    return this.inner.subscribe({ session_id: sessionId }, this.makeMetadata());
  }

  // ── Dispatch (webview postMessage forwarding) ──

  async dispatch(method: string, params: unknown): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case 'session/open':
        return (await this.sessionOpen(p as { file_path: string; workspace_name: string })).view;
      case 'session/save':
        return this.sessionSave();
      case 'session/close':
        return this.sessionClose();
      case 'session/generate':
        return this.sessionGenerate(
          p as {
            output_dir: string;
            options?: {
              dry_run?: boolean;
              format?: boolean;
              validate?: boolean;
              overwrite?: boolean;
            };
          },
        );
      case 'action/connect':
        return this.connect(
          p as { source: string; target: string; source_output: string; target_input: string },
        );
      case 'action/auto_connect':
        return this.autoConnect(p as { source: string; target: string });
      case 'action/disconnect':
        return this.disconnect(p as { target: string; input_name: string });
      case 'action/update_input':
        return this.updateInput(
          p as {
            instance_id: string;
            input_name: string;
            mode: string;
            value?: unknown;
            variable?: string;
            expression?: string;
          },
        );
      case 'action/update_all_inputs':
        return this.updateAllInputs(
          p as {
            instance_id: string;
            inputs: Array<{
              name: string;
              mode: string;
              value?: unknown;
              variable?: string;
              expression?: string;
            }>;
          },
        );
      case 'action/rename_instance':
        return this.renameInstance(p as { old_id: string; new_id: string });
      case 'action/delete_instance':
        return this.deleteInstance(p as { instance_id: string });
      case 'action/copy_instances':
        return this.copyInstances(p as { instance_ids: string[] });
      case 'action/sync_layout':
        return this.syncLayout(p as { positions: Record<string, { x: number; y: number }> });
      case 'action/create_group':
        return this.createGroup(p as { label: string; node_ids: string[] });
      case 'action/update_group':
        return this.updateGroup(
          p as { group_id: string; label?: string; node_ids?: string[]; collapsed?: boolean },
        );
      case 'action/delete_group':
        return this.deleteGroup(p as { group_id: string });
      case 'action/set_variables':
        return this.setVariables(
          p as {
            variables: Array<{
              name: string;
              type: string;
              required: boolean;
              description?: string;
              default?: unknown;
            }>;
          },
        );
      case 'action/set_exports':
        return this.setExports(
          p as {
            outputs: Array<{ name: string; source_instance: string; source_output: string }>;
            output_defs: Array<{
              name: string;
              type: string;
              description?: string;
              sensitive?: boolean;
            }>;
          },
        );
      case 'action/set_terraform':
        return this.setTerraform(
          p as {
            required_version?: string;
            required_providers?: Array<{ name: string; source: string; version: string }>;
          },
        );
      case 'action/set_providers':
        return this.setProviders(
          p as {
            providers: Array<{ name: string; alias?: string; config: Record<string, unknown> }>;
          },
        );
      case 'action/set_locals':
        return this.setLocals(
          p as {
            locals: Array<{
              name: string;
              mode: string;
              value?: unknown;
              variable?: string;
              expression?: string;
            }>;
          },
        );
      case 'action/set_depends_on':
        return this.setDependsOn(p as { instance_id: string; depends_on: string[] });
      case 'action/set_environments':
        return this.setEnvironments(p as { environments: Record<string, Record<string, unknown>> });
      case 'action/undo':
        return this.undo();
      case 'action/redo':
        return this.redo();
      case 'query/node_config':
        return this.queryNodeConfig(p as { instance_id: string });
      case 'query/edge_config':
        return this.queryEdgeConfig(p as { source: string; target: string });
      case 'query/settings':
        return this.querySettings();
      case 'query/graph_summary':
        return this.queryGraphSummary();
      case 'query/validate':
        return this.queryValidate();
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  // ── Cleanup ──

  dispose(): void {
    this._sessionId = null;
    this.inner.close();
  }
}
