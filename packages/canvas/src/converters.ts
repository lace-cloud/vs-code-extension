// Proto → render-model converters for ConnectWebEngine (browser-side).
// Uses canvas's local generated service (browser-safe, outputJsonMethods=true)
// so message classes have the `.fromJSON()` we need for Connect-JSON parsing.
//
// Note: host/src/transport.ts has its own equivalent converters against the
// grpc-js generated output. Render shapes are shared via @lace/proto — enums
// differ nominally across codegen outputs, which prevents reusing one converter.

import { NodeKind, InputMode, DiagnosticSeverity } from './generated/service';
import type {
  CanvasView as ProtoCanvasView,
  NodeConfig as ProtoNodeConfig,
  EdgeConfig as ProtoEdgeConfig,
  SettingsConfig as ProtoSettingsConfig,
  RenderNode as ProtoRenderNode,
  RenderInput as ProtoRenderInput,
  RenderError as ProtoRenderError,
  Diagnostic as ProtoDiagnostic,
} from './generated/service';
import type {
  CanvasView,
  NodeConfig,
  EdgeConfig,
  SettingsConfig,
  RenderNode,
  RenderInput,
  RenderError,
  Diagnostic,
} from '@lace/proto';

// ── Enum converters ──

export function convertNodeKind(value: NodeKind): 'module' | 'resource' | 'data' {
  switch (value) {
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

export function convertInputMode(
  value: InputMode,
): 'empty' | 'literal' | 'variable' | 'expression' | 'wired' {
  switch (value) {
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

export function convertDiagnosticSeverity(value: DiagnosticSeverity): 'error' | 'warning' | 'info' {
  switch (value) {
    case DiagnosticSeverity.DIAGNOSTIC_SEVERITY_WARNING:
      return 'warning';
    case DiagnosticSeverity.DIAGNOSTIC_SEVERITY_INFO:
      return 'info';
    default:
      return 'error';
  }
}

export function modeToInputMode(mode: string): InputMode {
  switch (mode) {
    case 'literal':
      return InputMode.INPUT_MODE_LITERAL;
    case 'variable':
      return InputMode.INPUT_MODE_VARIABLE;
    case 'expression':
      return InputMode.INPUT_MODE_EXPRESSION;
    default:
      return InputMode.INPUT_MODE_EMPTY;
  }
}

// ── Proto → render ──

export function convertRenderInput(input: ProtoRenderInput): RenderInput {
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

export function convertRenderNode(node: ProtoRenderNode): RenderNode {
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

export function convertRenderError(error: ProtoRenderError): RenderError {
  return {
    instance_id: error.instance_id || undefined,
    input_name: error.input_name || undefined,
    message: error.message,
  };
}

export function convertCanvasView(proto: ProtoCanvasView): CanvasView {
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
    })),
  };
}

export function convertNodeConfig(proto: ProtoNodeConfig): NodeConfig {
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

export function convertEdgeConfig(proto: ProtoEdgeConfig): EdgeConfig {
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

export function convertSettingsConfig(proto: ProtoSettingsConfig): SettingsConfig {
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

export function convertDiagnostic(d: ProtoDiagnostic): Diagnostic {
  return {
    severity: convertDiagnosticSeverity(d.severity),
    message: d.message,
    file: d.file || undefined,
    line: d.line || undefined,
    column: d.column || undefined,
  };
}
