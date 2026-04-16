// Proto → render-model converters.
//
// Shared by LaceTransport (host, gRPC-JS) and ConnectWebEngine (canvas,
// Connect-JSON). Accepts the structural shape aliases from `./proto-shapes`
// — this sidesteps the nominal enum identity problem between ts-proto's
// per-package outputs. See proto-shapes.ts for the full explanation.

import type {
  ProtoCanvasViewLike,
  ProtoDiagnosticLike,
  ProtoEdgeConfigLike,
  ProtoNodeConfigLike,
  ProtoRenderErrorLike,
  ProtoRenderInputLike,
  ProtoRenderNodeLike,
  ProtoSettingsConfigLike,
} from './proto-shapes';
import type {
  CanvasView,
  Diagnostic,
  EdgeConfig,
  NodeConfig,
  RenderError,
  RenderInput,
  RenderNode,
  SettingsConfig,
} from './render';

// Wire values match ts-proto's `snakeToCamel=false, numeric enum` output.
// Source of truth: the proto definition.
const NODE_KIND_MODULE = 1;
const NODE_KIND_RESOURCE = 2;
const NODE_KIND_DATA = 3;

const INPUT_MODE_EMPTY = 1;
const INPUT_MODE_LITERAL = 2;
const INPUT_MODE_VARIABLE = 3;
const INPUT_MODE_EXPRESSION = 4;
const INPUT_MODE_WIRED = 5;

const DIAGNOSTIC_SEVERITY_WARNING = 2;
const DIAGNOSTIC_SEVERITY_INFO = 3;

// ── Enum converters ──

export function convertNodeKind(value: number): 'module' | 'resource' | 'data' {
  switch (value) {
    case NODE_KIND_MODULE:
      return 'module';
    case NODE_KIND_RESOURCE:
      return 'resource';
    case NODE_KIND_DATA:
      return 'data';
    default:
      return 'module';
  }
}

export function convertInputMode(
  value: number,
): 'empty' | 'literal' | 'variable' | 'expression' | 'wired' {
  switch (value) {
    case INPUT_MODE_LITERAL:
      return 'literal';
    case INPUT_MODE_VARIABLE:
      return 'variable';
    case INPUT_MODE_EXPRESSION:
      return 'expression';
    case INPUT_MODE_WIRED:
      return 'wired';
    default:
      return 'empty';
  }
}

export function convertDiagnosticSeverity(value: number): 'error' | 'warning' | 'info' {
  switch (value) {
    case DIAGNOSTIC_SEVERITY_WARNING:
      return 'warning';
    case DIAGNOSTIC_SEVERITY_INFO:
      return 'info';
    default:
      return 'error';
  }
}

export function modeToInputMode(mode: string): number {
  switch (mode) {
    case 'literal':
      return INPUT_MODE_LITERAL;
    case 'variable':
      return INPUT_MODE_VARIABLE;
    case 'expression':
      return INPUT_MODE_EXPRESSION;
    case 'wired':
      return INPUT_MODE_WIRED;
    default:
      return INPUT_MODE_EMPTY;
  }
}

// ── Proto → render model ──

export function convertRenderInput(input: ProtoRenderInputLike): RenderInput {
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

export function convertRenderNode(node: ProtoRenderNodeLike): RenderNode {
  return {
    id: node.id,
    label: node.label,
    kind: convertNodeKind(node.kind),
    module_key: node.module_key || undefined,
    position: node.position ?? { x: 0, y: 0 },
    has_errors: node.has_errors,
    error_messages: node.error_messages,
    inputs: node.inputs.map((p) => ({
      name: p.name,
      type: p.type,
      required: p.required || undefined,
      wired: p.wired || undefined,
      description: p.description || undefined,
    })),
    outputs: node.outputs.map((p) => ({
      name: p.name,
      type: p.type,
      wired: p.wired || undefined,
      description: p.description || undefined,
      sensitive: p.sensitive || undefined,
    })),
  };
}

export function convertRenderError(error: ProtoRenderErrorLike): RenderError {
  return {
    instance_id: error.instance_id || undefined,
    input_name: error.input_name || undefined,
    message: error.message,
  };
}

export function convertCanvasView(proto: ProtoCanvasViewLike): CanvasView {
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
    groups: proto.groups.map((g) => ({
      id: g.id,
      label: g.label,
      node_ids: g.node_ids,
      collapsed: g.collapsed,
      module_key: g.module_key || undefined,
      inputs: g.inputs && g.inputs.length > 0 ? g.inputs : undefined,
      outputs: g.outputs && g.outputs.length > 0 ? g.outputs : undefined,
    })),
  };
}

export function convertNodeConfig(proto: ProtoNodeConfigLike): NodeConfig {
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
    available_variables: proto.available_variables.map((v) => ({ name: v.name, type: v.type })),
  };
}

export function convertEdgeConfig(proto: ProtoEdgeConfigLike): EdgeConfig {
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

export function convertSettingsConfig(proto: ProtoSettingsConfigLike): SettingsConfig {
  return {
    terraform: {
      required_version: proto.terraform?.required_version ?? '',
      required_providers: (proto.terraform?.required_providers ?? []).map((p) => ({
        name: p.name,
        source: p.source,
        version: p.version,
      })),
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
  };
}

export function convertDiagnostic(d: ProtoDiagnosticLike): Diagnostic {
  return {
    severity: convertDiagnosticSeverity(d.severity),
    message: d.message,
    file: d.file || undefined,
    line: d.line || undefined,
    column: d.column || undefined,
  };
}
