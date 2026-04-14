// RenderModel types — the extension's view of canvas state.
// All IR knowledge lives in the CLI. The extension only sees these projected types.

export type CanvasView = {
  module_name: string;
  nodes: RenderNode[];
  edges: RenderEdge[];
  errors: RenderError[];
  can_undo: boolean;
  can_redo: boolean;
  is_dirty: boolean;
};

export type RenderNode = {
  id: string;
  label: string;
  kind: 'module' | 'resource' | 'data';
  module_key?: string;
  icon_url?: string;
  position: { x: number; y: number };
  has_errors: boolean;
  error_messages: string[];
  inputs: NodePin[];
  outputs: NodePin[];
};

// NodePin is one input or output handle on a canvas node, rendered as a
// Blender-style connection point. Emitted directly by the CLI render layer.
export type NodePin = {
  name: string;
  type: string;
  type_family?: string;
  required?: boolean;
  wired?: boolean;
  description?: string;
  sensitive?: boolean;
};

export type RenderEdge = {
  id: string;
  source: string;
  target: string;
  source_output: string;
  target_input: string;
};

export type RenderInput = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default_value?: unknown;
  validation?: { condition: string; error_message: string };
  mode: 'empty' | 'literal' | 'variable' | 'expression' | 'wired';
  value?: unknown;
  variable?: string;
  expression?: string;
  wired_source?: string;
};

export type RenderOutput = {
  name: string;
  type: string;
  description?: string;
  sensitive?: boolean;
};

export type NodeConfig = {
  instance_id: string;
  inputs: RenderInput[];
  outputs: RenderOutput[];
  sibling_ids: string[];
  depends_on: string[];
  available_variables: Array<{ name: string; type: string }>;
};

export type EdgeConfig = {
  source_instance: string;
  target_instance: string;
  source_outputs: RenderOutput[];
  target_unbound_inputs: RenderInput[];
};

export type SettingsConfig = {
  terraform: {
    required_version: string;
    required_providers: Array<{ name: string; source: string; version: string }>;
  };
  providers: Array<{ name: string; alias: string; config: Record<string, unknown> }>;
  locals: Array<{ name: string; mode: string; value_display: string }>;
  environments: Record<string, Record<string, unknown>>;
};

export type RenderError = {
  instance_id?: string;
  input_name?: string;
  message: string;
};
