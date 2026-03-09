import * as grpc from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import {
  LaceEngineClient as GrpcLaceEngineClient,
  NodeKind,
  InputMode,
  DiagnosticSeverity,
} from '../../generated/proto/service';
import type {
  CanvasView as ProtoCanvasView,
  NodeConfig as ProtoNodeConfig,
  EdgeConfig as ProtoEdgeConfig,
  SettingsConfig as ProtoSettingsConfig,
  RenderNode as ProtoRenderNode,
  RenderInput as ProtoRenderInput,
  RenderError as ProtoRenderError,
  ValidateResponse,
  GraphSummaryResponse,
  GenerateResponse,
  InitializeResponse,
  ShutdownResponse,
  AuthStatusResponse,
  AuthLoginResponse,
  AuthLogoutResponse,
  RegistryListResponse,
  RegistryGetResponse,
  RegistryVersionResponse,
  SessionSaveResponse,
  SessionCloseResponse,
  Diagnostic as ProtoDiagnostic,
  Binding,
  OutputExport,
  LocalDef,
} from '../../generated/proto/service';
import type {
  CanvasView,
  NodeConfig,
  EdgeConfig,
  SettingsConfig,
  RenderNode,
  RenderInput,
  RenderError,
} from '../../webview/types/render';
import type { Diagnostic, RegistryModule } from '../../types/protocol';

// ── Auth result envelopes (re-exported for consumers) ──

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

// ── Internal result types ──

type RegistryListResult = {
  modules: RegistryModule[];
  pagination?: { page: number; limit: number; total: number };
};

type RegistryVersionResult = {
  name: string;
  system: string;
  version: string;
  deploy_bundle?: Buffer;
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
};

type RegistryModuleResult = {
  name: string;
  system: string;
  versions: Array<{ version: string; description?: string }>;
};

// ── Enum conversion helpers ──

function convertNodeKind(kind: NodeKind): 'module' | 'resource' | 'data' {
  switch (kind) {
    case NodeKind.NODE_KIND_MODULE:
      return 'module';
    case NodeKind.NODE_KIND_RESOURCE:
      return 'resource';
    case NodeKind.NODE_KIND_DATA:
      return 'data';
    default:
      return 'module';
  }
}

function convertInputMode(
  mode: InputMode,
): 'empty' | 'literal' | 'variable' | 'expression' | 'wired' {
  switch (mode) {
    case InputMode.INPUT_MODE_EMPTY:
      return 'empty';
    case InputMode.INPUT_MODE_LITERAL:
      return 'literal';
    case InputMode.INPUT_MODE_VARIABLE:
      return 'variable';
    case InputMode.INPUT_MODE_EXPRESSION:
      return 'expression';
    case InputMode.INPUT_MODE_WIRED:
      return 'wired';
    default:
      return 'empty';
  }
}

function convertDiagnosticSeverity(severity: DiagnosticSeverity): 'error' | 'warning' | 'info' {
  switch (severity) {
    case DiagnosticSeverity.DIAGNOSTIC_SEVERITY_ERROR:
      return 'error';
    case DiagnosticSeverity.DIAGNOSTIC_SEVERITY_WARNING:
      return 'warning';
    case DiagnosticSeverity.DIAGNOSTIC_SEVERITY_INFO:
      return 'info';
    default:
      return 'error';
  }
}

// ── Proto → extension type converters ──

function convertRenderInput(input: ProtoRenderInput): RenderInput {
  return {
    name: input.name,
    type: input.type,
    required: input.required,
    description: input.description || undefined,
    default_value: input.default_value ?? undefined,
    validation: input.validation
      ? { condition: input.validation.condition, error_message: input.validation.error_message }
      : undefined,
    mode: convertInputMode(input.mode),
    value: input.value ?? undefined,
    variable: input.variable || undefined,
    expression: input.expression || undefined,
    wired_source: input.wired_source || undefined,
  };
}

function convertRenderNode(node: ProtoRenderNode): RenderNode {
  return {
    id: node.id,
    label: node.label,
    kind: convertNodeKind(node.kind),
    module_key: node.module_key || undefined,
    position: node.position ?? { x: 0, y: 0 },
    has_errors: node.has_errors,
    error_messages: node.error_messages,
  };
}

function convertRenderError(error: ProtoRenderError): RenderError {
  return {
    instance_id: error.instance_id || undefined,
    input_name: error.input_name || undefined,
    message: error.message,
  };
}

function convertCanvasView(proto: ProtoCanvasView): CanvasView {
  return {
    module_name: proto.module_name,
    nodes: proto.nodes.map(convertRenderNode),
    edges: proto.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      source_output: e.source_output,
      target_input: e.target_input,
    })),
    errors: proto.errors.map(convertRenderError),
    can_undo: proto.can_undo,
    can_redo: proto.can_redo,
    is_dirty: proto.is_dirty,
  };
}

function convertNodeConfig(proto: ProtoNodeConfig): NodeConfig {
  return {
    instance_id: proto.instance_id,
    inputs: proto.inputs.map(convertRenderInput),
    outputs: proto.outputs.map((o) => ({
      name: o.name,
      type: o.type,
      description: o.description || undefined,
      sensitive: o.sensitive,
    })),
    sibling_ids: proto.sibling_ids,
    depends_on: proto.depends_on,
    available_variables: proto.available_variables.map((v) => ({
      name: v.name,
      type: v.type,
    })),
  };
}

function convertEdgeConfig(proto: ProtoEdgeConfig): EdgeConfig {
  return {
    source_instance: proto.source_instance,
    target_instance: proto.target_instance,
    source_outputs: proto.source_outputs.map((o) => ({
      name: o.name,
      type: o.type,
      description: o.description || undefined,
      sensitive: o.sensitive,
    })),
    target_unbound_inputs: proto.target_unbound_inputs.map(convertRenderInput),
  };
}

function convertSettingsConfig(proto: ProtoSettingsConfig): SettingsConfig {
  return {
    terraform: {
      required_version: proto.terraform?.required_version ?? '',
      required_providers: (proto.terraform?.required_providers ?? []).map((p) => ({
        name: p.name,
        source: p.source,
        version: p.version,
      })),
      backend: proto.terraform?.backend
        ? { type: proto.terraform.backend.type, config: proto.terraform.backend.config ?? {} }
        : undefined,
    },
    providers: proto.providers.map((p) => ({
      name: p.name,
      alias: p.alias,
      config: p.config ?? {},
    })),
    locals: proto.locals.map((l) => ({
      name: l.name,
      mode: l.mode,
      value_display: l.value_display,
    })),
    environments: (proto.environments ?? {}) as Record<string, Record<string, unknown>>,
    environment_backends: Object.fromEntries(
      Object.entries(proto.environment_backends ?? {}).map(([k, v]) => [
        k,
        { type: v.type, config: v.config ?? {} },
      ]),
    ),
  };
}

function convertDiagnostic(d: ProtoDiagnostic): Diagnostic {
  return {
    severity: convertDiagnosticSeverity(d.severity),
    message: d.message,
    file: d.file || undefined,
    line: d.line || undefined,
    column: d.column || undefined,
  };
}

function convertUser(
  user: { id: string; email: string; name: string } | undefined,
): { id: string; email: string; name: string } | undefined {
  if (!user) return undefined;
  return { id: user.id, email: user.email, name: user.name };
}

// ── LaceClient ──

export class LaceClient {
  private inner: GrpcLaceEngineClient;

  constructor(port: number) {
    const address = `127.0.0.1:${port}`;
    this.inner = new GrpcLaceEngineClient(address, grpc.credentials.createInsecure());
  }

  // ── Private helper: promisify unary calls ──

  private unary<Req, Res>(
    method: (request: Req, callback: (error: ServiceError | null, response: Res) => void) => void,
    request: Req,
  ): Promise<Res> {
    return new Promise<Res>((resolve, reject) => {
      method.call(this.inner, request, (error: ServiceError | null, response: Res) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
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

  async shutdown(): Promise<{ status: string }> {
    const res = await this.unary<Record<string, never>, ShutdownResponse>(this.inner.shutdown, {});
    return { status: res.status };
  }

  // ── Auth ──

  async authStatus(): Promise<AuthStatusResult> {
    const res = await this.unary<Record<string, never>, AuthStatusResponse>(
      this.inner.authStatus,
      {},
    );
    return {
      authenticated: res.authenticated,
      user: convertUser(res.user),
      base_url: res.base_url || undefined,
    };
  }

  async authLogin(params: { token: string }): Promise<AuthLoginResult> {
    const res = await this.unary<{ token: string }, AuthLoginResponse>(this.inner.authLogin, {
      token: params.token,
    });
    return {
      success: res.success,
      user: convertUser(res.user),
      error: res.error || undefined,
    };
  }

  async authLogout(): Promise<{ success: boolean }> {
    const res = await this.unary<Record<string, never>, AuthLogoutResponse>(
      this.inner.authLogout,
      {},
    );
    return { success: res.success };
  }

  // ── Registry ──

  async listRegistryModules(params?: {
    system?: string;
    search?: string;
    category?: string;
    page?: number;
    limit?: number;
    organization?: string;
  }): Promise<RegistryListResult> {
    const res = await this.unary<
      {
        system: string;
        search: string;
        category: string;
        page: number;
        limit: number;
        organization: string;
      },
      RegistryListResponse
    >(this.inner.registryList, {
      system: params?.system ?? '',
      search: params?.search ?? '',
      category: params?.category ?? '',
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
      pagination: res.pagination
        ? { page: res.pagination.page, limit: res.pagination.limit, total: res.pagination.total }
        : undefined,
    };
  }

  async getRegistryVersion(params: {
    name: string;
    system: string;
    version: string;
    organization?: string;
  }): Promise<RegistryVersionResult> {
    const res = await this.unary<
      { name: string; system: string; version: string; organization: string },
      RegistryVersionResponse
    >(this.inner.registryVersion, {
      name: params.name,
      system: params.system,
      version: params.version,
      organization: params.organization ?? '',
    });
    return {
      name: res.name,
      system: res.system,
      version: res.version,
      deploy_bundle: res.deploy_bundle,
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

  async getRegistryModule(params: {
    name: string;
    system: string;
    organization?: string;
  }): Promise<RegistryModuleResult> {
    const res = await this.unary<
      { name: string; system: string; organization: string },
      RegistryGetResponse
    >(this.inner.registryGet, {
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

  // ── Session ──

  async sessionOpen(params: { file_path: string; workspace_name: string }): Promise<CanvasView> {
    const res = await this.unary<{ file_path: string; workspace_name: string }, ProtoCanvasView>(
      this.inner.sessionOpen,
      params,
    );
    return convertCanvasView(res);
  }

  async sessionSave(): Promise<{ saved: boolean }> {
    const res = await this.unary<Record<string, never>, SessionSaveResponse>(
      this.inner.sessionSave,
      {},
    );
    return { saved: res.saved };
  }

  async sessionClose(): Promise<{ status: string }> {
    const res = await this.unary<Record<string, never>, SessionCloseResponse>(
      this.inner.sessionClose,
      {},
    );
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
        output_dir: string;
        options:
          | { dry_run: boolean; format: boolean; validate: boolean; overwrite: boolean }
          | undefined;
      },
      GenerateResponse
    >(this.inner.sessionGenerate, {
      output_dir: params.output_dir,
      options: params.options
        ? {
            dry_run: params.options.dry_run ?? false,
            format: params.options.format ?? false,
            validate: params.options.validate ?? false,
            overwrite: params.options.overwrite ?? false,
          }
        : undefined,
    });
    return {
      files_written: res.files_written.length > 0 ? res.files_written : undefined,
      files: Object.keys(res.files).length > 0 ? res.files : undefined,
      diagnostics: res.diagnostics.map(convertDiagnostic),
    };
  }

  // ── Actions ──

  async actionDropBundle(params: {
    deploy_bundle: Buffer;
    position?: { x: number; y: number };
  }): Promise<CanvasView> {
    const res = await this.unary<
      { deploy_bundle: Buffer; position: { x: number; y: number } | undefined },
      ProtoCanvasView
    >(this.inner.actionDropBundle, {
      deploy_bundle: params.deploy_bundle,
      position: params.position,
    });
    return convertCanvasView(res);
  }

  async actionConnect(params: {
    source: string;
    target: string;
    source_output: string;
    target_input: string;
  }): Promise<CanvasView> {
    const res = await this.unary<typeof params, ProtoCanvasView>(this.inner.actionConnect, params);
    return convertCanvasView(res);
  }

  async actionAutoConnect(params: { source: string; target: string }): Promise<CanvasView> {
    const res = await this.unary<typeof params, ProtoCanvasView>(
      this.inner.actionAutoConnect,
      params,
    );
    return convertCanvasView(res);
  }

  async actionDisconnect(params: { target: string; input_name: string }): Promise<CanvasView> {
    const res = await this.unary<typeof params, ProtoCanvasView>(
      this.inner.actionDisconnect,
      params,
    );
    return convertCanvasView(res);
  }

  async actionUpdateInput(params: {
    instance_id: string;
    input_name: string;
    mode: string;
    value?: unknown;
    variable?: string;
    expression?: string;
  }): Promise<CanvasView> {
    const res = await this.unary<
      { instance_id: string; input_name: string; binding: Binding | undefined },
      ProtoCanvasView
    >(this.inner.actionUpdateInput, {
      instance_id: params.instance_id,
      input_name: params.input_name,
      binding: modeToBinding(params.mode, params.value, params.variable, params.expression),
    });
    return convertCanvasView(res);
  }

  async actionUpdateAllInputs(params: {
    instance_id: string;
    inputs: Array<{
      name: string;
      mode: string;
      value?: unknown;
      variable?: string;
      expression?: string;
    }>;
  }): Promise<CanvasView> {
    const inputs: { [key: string]: Binding } = {};
    for (const inp of params.inputs) {
      inputs[inp.name] = modeToBinding(inp.mode, inp.value, inp.variable, inp.expression);
    }
    const res = await this.unary<
      { instance_id: string; inputs: { [key: string]: Binding } },
      ProtoCanvasView
    >(this.inner.actionUpdateAllInputs, {
      instance_id: params.instance_id,
      inputs,
    });
    return convertCanvasView(res);
  }

  async actionRenameInstance(params: { old_id: string; new_id: string }): Promise<CanvasView> {
    const res = await this.unary<typeof params, ProtoCanvasView>(
      this.inner.actionRenameInstance,
      params,
    );
    return convertCanvasView(res);
  }

  async actionDeleteInstance(params: { instance_id: string }): Promise<CanvasView> {
    const res = await this.unary<typeof params, ProtoCanvasView>(
      this.inner.actionDeleteInstance,
      params,
    );
    return convertCanvasView(res);
  }

  async actionSyncLayout(params: {
    positions: Record<string, { x: number; y: number }>;
  }): Promise<Record<string, never>> {
    await this.unary<{ positions: Record<string, { x: number; y: number }> }, ProtoCanvasView>(
      this.inner.actionSyncLayout,
      params,
    );
    return {};
  }

  async actionSetVariables(params: {
    variables: Array<{
      name: string;
      type: string;
      required: boolean;
      description?: string;
      default?: unknown;
    }>;
  }): Promise<CanvasView> {
    const res = await this.unary<
      {
        variables: Array<{
          name: string;
          type: string;
          required: boolean;
          description: string;
          default_value: unknown;
          validation: undefined;
        }>;
      },
      ProtoCanvasView
    >(this.inner.actionSetVariables, {
      variables: params.variables.map((v) => ({
        name: v.name,
        type: v.type,
        required: v.required,
        description: v.description ?? '',
        default_value: v.default ?? undefined,
        validation: undefined,
      })),
    });
    return convertCanvasView(res);
  }

  async actionSetExports(params: {
    outputs: Array<{ name: string; source_instance: string; source_output: string }>;
    output_defs: Array<{ name: string; type: string; description?: string; sensitive?: boolean }>;
  }): Promise<CanvasView> {
    const outputs: { [key: string]: OutputExport } = {};
    for (const o of params.outputs) {
      outputs[o.name] = {
        out: { module: o.source_instance, name: o.source_output },
        var: '',
        expr: undefined,
        lit: undefined,
      };
    }
    const res = await this.unary<
      {
        outputs: { [key: string]: OutputExport };
        output_defs: Array<{
          name: string;
          type: string;
          description: string;
          sensitive: boolean;
        }>;
      },
      ProtoCanvasView
    >(this.inner.actionSetExports, {
      outputs,
      output_defs: params.output_defs.map((d) => ({
        name: d.name,
        type: d.type,
        description: d.description ?? '',
        sensitive: d.sensitive ?? false,
      })),
    });
    return convertCanvasView(res);
  }

  async actionSetTerraform(params: {
    required_version?: string;
    required_providers?: Array<{ name: string; source: string; version: string }>;
    backend?: { type: string; config: Record<string, unknown> };
  }): Promise<Record<string, never>> {
    const requiredProviders: Record<string, { source: string; version: string }> = {};
    for (const p of params.required_providers ?? []) {
      requiredProviders[p.name] = { source: p.source, version: p.version };
    }
    await this.unary<
      {
        terraform: {
          required_version: string;
          required_providers: Record<string, { source: string; version: string }>;
          backend: { type: string; config: Record<string, unknown> } | undefined;
        };
      },
      ProtoCanvasView
    >(this.inner.actionSetTerraform, {
      terraform: {
        required_version: params.required_version ?? '',
        required_providers: requiredProviders,
        backend: params.backend,
      },
    });
    return {};
  }

  async actionSetProviders(params: {
    providers: Array<{ name: string; alias?: string; config: Record<string, unknown> }>;
  }): Promise<Record<string, never>> {
    await this.unary<
      {
        providers: Array<{ name: string; alias: string; config: Record<string, unknown> }>;
      },
      ProtoCanvasView
    >(this.inner.actionSetProviders, {
      providers: params.providers.map((p) => ({
        name: p.name,
        alias: p.alias ?? '',
        config: p.config,
      })),
    });
    return {};
  }

  async actionSetLocals(params: {
    locals: Array<{
      name: string;
      mode: string;
      value?: unknown;
      variable?: string;
      expression?: string;
    }>;
  }): Promise<CanvasView> {
    const res = await this.unary<{ locals: LocalDef[] }, ProtoCanvasView>(
      this.inner.actionSetLocals,
      {
        locals: params.locals.map((l) => ({
          name: l.name,
          value: modeToBinding(l.mode, l.value, l.variable, l.expression),
        })),
      },
    );
    return convertCanvasView(res);
  }

  async actionSetDependsOn(params: {
    instance_id: string;
    depends_on: string[];
  }): Promise<Record<string, never>> {
    await this.unary<typeof params, ProtoCanvasView>(this.inner.actionSetDependsOn, params);
    return {};
  }

  async actionSetEnvironments(params: {
    environments: Record<string, Record<string, unknown>>;
    environment_backends: Record<string, { type: string; config: Record<string, unknown> }>;
  }): Promise<Record<string, never>> {
    await this.unary<typeof params, ProtoCanvasView>(this.inner.actionSetEnvironments, params);
    return {};
  }

  async actionUndo(): Promise<CanvasView> {
    const res = await this.unary<Record<string, never>, ProtoCanvasView>(this.inner.actionUndo, {});
    return convertCanvasView(res);
  }

  async actionRedo(): Promise<CanvasView> {
    const res = await this.unary<Record<string, never>, ProtoCanvasView>(this.inner.actionRedo, {});
    return convertCanvasView(res);
  }

  // ── Queries ──

  async queryNodeConfig(params: { instance_id: string }): Promise<NodeConfig> {
    const res = await this.unary<typeof params, ProtoNodeConfig>(
      this.inner.queryNodeConfig,
      params,
    );
    return convertNodeConfig(res);
  }

  async queryEdgeConfig(params: { source: string; target: string }): Promise<EdgeConfig> {
    const res = await this.unary<typeof params, ProtoEdgeConfig>(
      this.inner.queryEdgeConfig,
      params,
    );
    return convertEdgeConfig(res);
  }

  async querySettings(): Promise<SettingsConfig> {
    const res = await this.unary<Record<string, never>, ProtoSettingsConfig>(
      this.inner.querySettings,
      {},
    );
    return convertSettingsConfig(res);
  }

  async queryGraphSummary(): Promise<{ text: string }> {
    const res = await this.unary<Record<string, never>, GraphSummaryResponse>(
      this.inner.queryGraphSummary,
      {},
    );
    return { text: res.text };
  }

  async queryValidate(): Promise<{ errors: RenderError[] }> {
    const res = await this.unary<Record<string, never>, ValidateResponse>(
      this.inner.queryValidate,
      {},
    );
    return { errors: res.errors.map(convertRenderError) };
  }

  // ── Dispatch (webview postMessage forwarding) ──

  async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'session/open':
        return this.sessionOpen(params as { file_path: string; workspace_name: string });
      case 'session/save':
        return this.sessionSave();
      case 'session/close':
        return this.sessionClose();
      case 'session/generate':
        return this.sessionGenerate(
          params as {
            output_dir: string;
            options?: {
              dry_run?: boolean;
              format?: boolean;
              validate?: boolean;
              overwrite?: boolean;
            };
          },
        );
      case 'action/drop_bundle':
        return this.actionDropBundle(
          params as { deploy_bundle: Buffer; position?: { x: number; y: number } },
        );
      case 'action/connect':
        return this.actionConnect(
          params as {
            source: string;
            target: string;
            source_output: string;
            target_input: string;
          },
        );
      case 'action/auto_connect':
        return this.actionAutoConnect(params as { source: string; target: string });
      case 'action/disconnect':
        return this.actionDisconnect(params as { target: string; input_name: string });
      case 'action/update_input':
        return this.actionUpdateInput(
          params as {
            instance_id: string;
            input_name: string;
            mode: string;
            value?: unknown;
            variable?: string;
            expression?: string;
          },
        );
      case 'action/update_all_inputs':
        return this.actionUpdateAllInputs(
          params as {
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
        return this.actionRenameInstance(params as { old_id: string; new_id: string });
      case 'action/delete_instance':
        return this.actionDeleteInstance(params as { instance_id: string });
      case 'action/sync_layout':
        return this.actionSyncLayout(
          params as { positions: Record<string, { x: number; y: number }> },
        );
      case 'action/set_variables':
        return this.actionSetVariables(
          params as {
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
        return this.actionSetExports(
          params as {
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
        return this.actionSetTerraform(
          params as {
            required_version?: string;
            required_providers?: Array<{ name: string; source: string; version: string }>;
            backend?: { type: string; config: Record<string, unknown> };
          },
        );
      case 'action/set_providers':
        return this.actionSetProviders(
          params as {
            providers: Array<{ name: string; alias?: string; config: Record<string, unknown> }>;
          },
        );
      case 'action/set_locals':
        return this.actionSetLocals(
          params as {
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
        return this.actionSetDependsOn(params as { instance_id: string; depends_on: string[] });
      case 'action/set_environments':
        return this.actionSetEnvironments(
          params as {
            environments: Record<string, Record<string, unknown>>;
            environment_backends: Record<string, { type: string; config: Record<string, unknown> }>;
          },
        );
      case 'action/undo':
        return this.actionUndo();
      case 'action/redo':
        return this.actionRedo();
      case 'query/node_config':
        return this.queryNodeConfig(params as { instance_id: string });
      case 'query/edge_config':
        return this.queryEdgeConfig(params as { source: string; target: string });
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
    this.inner.close();
  }
}

// ── Helper: convert mode+value to proto Binding ──

function modeToBinding(
  mode: string,
  value?: unknown,
  variable?: string,
  expression?: string,
): Binding {
  switch (mode) {
    case 'literal':
      return { lit: value };
    case 'variable':
      return { var: variable };
    case 'expression':
      return { expr: { lang: 'hcl', value: expression ?? '' } };
    default:
      return {};
  }
}
