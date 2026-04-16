// Render model types — the POJO shape both host and canvas speak.
// Proto messages are converted to these via the converters in `./converters`.
// Having them here gives ConnectWebEngine (browser) and LaceTransport (node)
// a single source of truth instead of duplicating types across packages.

export type CanvasView = {
  module_name: string;
  nodes: RenderNode[];
  edges: RenderEdge[];
  errors: RenderError[];
  can_undo: boolean;
  can_redo: boolean;
  is_dirty: boolean;
  groups: RenderGroup[];
};

// RenderGroup represents a composite module instance on the canvas.
// A group IS a composite IS a Terraform module — one concept, three names.
//   - Registry-dropped composites (iam_stack, etc.) carry a non-empty
//     `module_key` pointing at the bundle source and publish their
//     declared Interface as `inputs`/`outputs` boundary pins.
//   - User-created groups (from the "Group" canvas action) leave
//     `module_key` empty and carry pins derived from crossing edges
//     (empty in commit 3 — crossing edges are rejected there).
export type RenderGroup = {
  id: string;
  label: string;
  node_ids: string[];
  collapsed: boolean;
  module_key?: string;
  inputs?: NodePin[];
  outputs?: NodePin[];
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

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  message: string;
  instance_id?: string;
  address?: string;
  file?: string;
  line?: number;
  column?: number;
};

export type GeneratePhase = 'generating' | 'formatting' | 'validating';

export type HostToWebview =
  | { command: 'loadState'; state: CanvasView }
  | { command: 'generateProgress'; phase: GeneratePhase }
  | { command: 'generateSuccess'; files?: string[] }
  | { command: 'generateError'; message: string; diagnostics?: Diagnostic[] }
  | { command: 'engineResult'; requestId: string; result?: unknown; error?: string };
