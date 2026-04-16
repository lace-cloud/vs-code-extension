// Structural aliases for proto message shapes.
//
// Why this file exists: ts-proto emits three distinct generated files
// (packages/{proto,host,canvas}/src/generated/service.ts) with identical
// message interfaces but *nominally distinct* enum declarations. This is
// intrinsic to how TypeScript treats `export enum` — two enums with the
// same members but declared in different modules are NOT assignable to
// each other.
//
// The converters here need to accept proto messages from any codegen
// output. By declaring the enum fields as `number` (to which every numeric
// enum value is assignable via widening), and relying on TypeScript's
// structural assignment rules for everything else, a single converter
// covers host-generated AND canvas-generated AND proto-generated inputs.

import type {
  NodePin,
  Position,
  ValidationBlock,
  RenderEdge,
  RenderGroup,
  RenderOutput,
  VariableRef,
  TerraformView,
  ProviderView,
  LocalView,
} from './generated/service';

export type ProtoDiagnosticLike = {
  severity: number;
  message: string;
  file: string;
  line: number;
  column: number;
  instance_id?: string;
  address?: string;
};

export type ProtoRenderInputLike = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default_value?: unknown;
  validation?: { condition: string; error_message: string } | ValidationBlock;
  mode: number;
  value?: unknown;
  variable: string;
  expression: string;
  wired_source: string;
};

export type ProtoRenderNodeLike = {
  id: string;
  label: string;
  kind: number;
  module_key: string;
  icon_url: string;
  position?: { x: number; y: number } | Position;
  has_errors: boolean;
  error_messages: string[];
  inputs: NodePin[];
  outputs: NodePin[];
};

export type ProtoRenderErrorLike = {
  instance_id: string;
  input_name: string;
  message: string;
};

export type ProtoCanvasViewLike = {
  module_name: string;
  nodes: ProtoRenderNodeLike[];
  edges: RenderEdge[];
  errors: ProtoRenderErrorLike[];
  can_undo: boolean;
  can_redo: boolean;
  is_dirty: boolean;
  groups: RenderGroup[];
};

export type ProtoNodeConfigLike = {
  instance_id: string;
  inputs: ProtoRenderInputLike[];
  outputs: RenderOutput[];
  sibling_ids: string[];
  depends_on: string[];
  available_variables: VariableRef[];
};

export type ProtoEdgeConfigLike = {
  source_instance: string;
  target_instance: string;
  source_outputs: RenderOutput[];
  target_unbound_inputs: ProtoRenderInputLike[];
};

export type ProtoSettingsConfigLike = {
  terraform?: TerraformView;
  providers: ProviderView[];
  locals: LocalView[];
  environments: Record<string, Record<string, unknown> | undefined>;
};
