import type {
  CanvasView,
  NodeConfig,
  EdgeConfig,
  SettingsConfig,
  RenderError,
  Diagnostic,
  GeneratePhase,
  ViewportIntent,
} from './types/render';

// Engine is the interface to the CLI session. All canvas operations go through here.
// The webview holds no IR state — everything is projected by the CLI.

/**
 * Engine-emitted events. Both PostMessageEngine and ConnectWebEngine publish
 * these through `onEvent` so UI layers subscribe once regardless of transport.
 */
export type EngineEvent =
  | { type: 'stateUpdated'; view: CanvasView; viewportIntent?: ViewportIntent }
  | { type: 'generateProgress'; phase: GeneratePhase }
  | { type: 'generateSuccess'; files?: string[] }
  | { type: 'generateError'; message: string; diagnostics?: Diagnostic[] };

export type EngineEventListener = (event: EngineEvent) => void;

export type GenerateResult = {
  files_written?: string[];
  files?: Record<string, string>;
  diagnostics: Diagnostic[];
};

export type GraphSummary = {
  text: string;
};

export type InputUpdate = {
  name: string;
  mode: 'empty' | 'literal' | 'variable' | 'expression';
  value?: unknown;
  variable?: string;
  expression?: string;
};

export type VariableDef = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
};

export type OutputExportDef = {
  name: string;
  source_instance: string;
  source_output: string;
};

export type OutputDefEntry = {
  name: string;
  type: string;
  description?: string;
  sensitive?: boolean;
};

export type ProviderDef = {
  name: string;
  source: string;
  version: string;
};

export type ProviderConfigDef = {
  name: string;
  alias?: string;
  config: Record<string, unknown>;
};

export type LocalDef = {
  name: string;
  mode: string;
  value?: unknown;
  variable?: string;
  expression?: string;
};

// The engine interface — implemented by the RPC bridge in the host extension.
// Webview code calls these methods via postMessage to the host,
// which forwards them to the CLI process.
export interface CanvasEngine {
  // Session
  sessionOpen(filePath: string, workspaceName: string): Promise<CanvasView>;
  sessionSave(): Promise<{ saved: boolean }>;
  sessionClose(): Promise<{ status: string }>;
  sessionGenerate(
    outputDir: string,
    options: {
      dry_run?: boolean;
      format?: boolean;
      validate?: boolean;
      overwrite?: boolean;
    },
  ): Promise<GenerateResult>;

  // Actions
  connect(
    source: string,
    target: string,
    sourceOutput: string,
    targetInput: string,
  ): Promise<CanvasView>;
  autoConnect(source: string, target: string): Promise<CanvasView>;
  disconnect(target: string, inputName: string): Promise<CanvasView>;
  updateInput(
    instanceId: string,
    inputName: string,
    mode: string,
    value?: unknown,
    variable?: string,
    expression?: string,
  ): Promise<CanvasView>;
  updateAllInputs(instanceId: string, inputs: InputUpdate[]): Promise<CanvasView>;
  renameInstance(oldId: string, newId: string): Promise<CanvasView>;
  deleteInstance(instanceId: string): Promise<CanvasView>;
  copyInstances(instanceIds: string[]): Promise<CanvasView>;
  syncLayout(positions: Record<string, { x: number; y: number }>): Promise<void>;
  setVariables(variables: VariableDef[]): Promise<CanvasView>;
  setExports(outputs: OutputExportDef[], outputDefs: OutputDefEntry[]): Promise<CanvasView>;
  setTerraform(requiredVersion?: string, requiredProviders?: ProviderDef[]): Promise<void>;
  setProviders(providers: ProviderConfigDef[]): Promise<void>;
  setLocals(locals: LocalDef[]): Promise<CanvasView>;
  setDependsOn(instanceId: string, dependsOn: string[]): Promise<void>;
  setEnvironments(environments: Record<string, Record<string, unknown>>): Promise<void>;
  undo(): Promise<CanvasView>;
  redo(): Promise<CanvasView>;

  // Groups
  createGroup(label: string, nodeIds: string[]): Promise<CanvasView>;
  updateGroup(
    groupId: string,
    updates: { label?: string; node_ids?: string[]; collapsed?: boolean },
  ): Promise<CanvasView>;
  deleteGroup(groupId: string): Promise<CanvasView>;

  // Queries
  queryNodeConfig(instanceId: string): Promise<NodeConfig>;
  queryEdgeConfig(source: string, target: string): Promise<EdgeConfig>;
  querySettings(): Promise<SettingsConfig>;
  queryGraphSummary(): Promise<GraphSummary>;
  queryValidate(): Promise<{ errors: RenderError[] }>;

  /**
   * Subscribe to engine events. Returns an unsubscribe function. Called from
   * App (for state updates) and useGenerationStatus (for generate progress).
   */
  onEvent(listener: EngineEventListener): () => void;
}
